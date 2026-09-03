// compute real admin compliance metrics from sqlite database
function getComplianceMetrics(db, { now = new Date().toISOString() } = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("Database instance required");
  }

  const nowDate = new Date(now);
  const thirtyDaysLater = new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. fetch all core rows
  const modules = db.prepare("SELECT module_id, title, pass_threshold, version, recert_months FROM module ORDER BY module_id").all();
  const mines = db.prepare("SELECT mine_id, name, district FROM mine ORDER BY mine_id").all();
  const contractors = db.prepare("SELECT contractor_id, name FROM contractor ORDER BY contractor_id").all();
  const workers = db.prepare(`
    SELECT w.worker_id, w.name, w.mine_id, m.name AS mine_name, w.contractor_id, c.name AS contractor_name
    FROM worker w
    LEFT JOIN mine m ON w.mine_id = m.mine_id
    LEFT JOIN contractor c ON w.contractor_id = c.contractor_id
    ORDER BY w.worker_id
  `).all();

  const attempts = db.prepare(`
    SELECT attempt_id, worker_id, module_id, server_percentage, server_passed, completed_at, ar_tier, locale
    FROM attempt
    ORDER BY completed_at DESC
  `).all();

  const certificates = db.prepare(`
    SELECT cert_id, worker_id, module_id, attempt_id, score, issued_at, expires_at, revoked
    FROM certificate
    WHERE revoked = 0
  `).all();

  // 2. build worker attempt & cert lookups
  // workerId -> moduleId -> { attempts: [], bestScore, passed: boolean, lastCompletedAt, cert }
  const workerModuleMap = new Map();
  workers.forEach((w) => {
    workerModuleMap.set(w.worker_id, new Map());
  });

  attempts.forEach((att) => {
    if (!workerModuleMap.has(att.worker_id)) {
      workerModuleMap.set(att.worker_id, new Map());
    }
    const modMap = workerModuleMap.get(att.worker_id);
    if (!modMap.has(att.module_id)) {
      modMap.set(att.module_id, {
        attemptsCount: 0,
        passed: false,
        bestScore: 0,
        lastCompletedAt: null
      });
    }
    const state = modMap.get(att.module_id);
    state.attemptsCount += 1;
    if (att.server_passed === 1) {
      state.passed = true;
    }
    if (att.server_percentage > state.bestScore) {
      state.bestScore = att.server_percentage;
    }
    if (!state.lastCompletedAt || att.completed_at > state.lastCompletedAt) {
      state.lastCompletedAt = att.completed_at;
    }
  });

  const certMap = new Map(); // workerId -> moduleId -> cert
  certificates.forEach((cert) => {
    if (!certMap.has(cert.worker_id)) {
      certMap.set(cert.worker_id, new Map());
    }
    certMap.get(cert.worker_id).set(cert.module_id, cert);
  });

  // 3. calculate worker compliance states
  const totalModuleCount = modules.length;
  let fullyCompliantWorkerCount = 0;
  let partiallyCompliantWorkerCount = 0;
  let nonCompliantWorkerCount = 0;

  const workerRoster = workers.map((w) => {
    const modMap = workerModuleMap.get(w.worker_id) || new Map();
    const wCerts = certMap.get(w.worker_id) || new Map();
    let passedCount = 0;
    let attemptedCount = 0;

    const moduleDetails = {};
    modules.forEach((mod) => {
      const state = modMap.get(mod.module_id);
      const cert = wCerts.get(mod.module_id);

      let status = "not_started";
      if (state && state.passed) {
        status = cert ? "certified" : "passed";
        passedCount += 1;
      } else if (state && state.attemptsCount > 0) {
        status = "failed";
      }
      if (state && state.attemptsCount > 0) {
        attemptedCount += 1;
      }

      moduleDetails[mod.module_id] = {
        moduleId: mod.module_id,
        moduleTitle: mod.title,
        status,
        passed: state ? state.passed : false,
        attemptsCount: state ? state.attemptsCount : 0,
        bestScore: state ? state.bestScore : null,
        lastCompletedAt: state ? state.lastCompletedAt : null,
        certId: cert ? cert.cert_id : null,
        expiresAt: cert ? cert.expires_at : null
      };
    });

    let overallStatus = "non_compliant";
    if (totalModuleCount > 0 && passedCount >= totalModuleCount) {
      overallStatus = "compliant";
      fullyCompliantWorkerCount += 1;
    } else if (passedCount > 0 || attemptedCount > 0) {
      overallStatus = "in_progress";
      partiallyCompliantWorkerCount += 1;
    } else {
      nonCompliantWorkerCount += 1;
    }

    return {
      workerId: w.worker_id,
      name: w.name,
      mineId: w.mine_id,
      mineName: w.mine_name || "Unassigned",
      contractorId: w.contractor_id,
      contractorName: w.contractor_name || "Unassigned",
      overallStatus,
      passedModulesCount: passedCount,
      totalRequiredModules: totalModuleCount,
      modules: moduleDetails
    };
  });

  // 4. calculate module breakdown
  const moduleBreakdown = modules.map((mod) => {
    const modAttempts = attempts.filter((a) => a.module_id === mod.module_id);
    const passedAttempts = modAttempts.filter((a) => a.server_passed === 1);
    const uniqueWorkersAttempted = new Set(modAttempts.map((a) => a.worker_id)).size;
    const uniqueWorkersPassed = new Set(passedAttempts.map((a) => a.worker_id)).size;

    const totalScores = modAttempts.reduce((acc, cur) => acc + cur.server_percentage, 0);
    const avgScore = modAttempts.length > 0 ? Math.round((totalScores / modAttempts.length) * 10) / 10 : null;

    const workerPassRate = workers.length > 0
      ? Math.round((uniqueWorkersPassed / workers.length) * 1000) / 10
      : 0;

    return {
      moduleId: mod.module_id,
      title: mod.title,
      passThreshold: mod.pass_threshold,
      recertMonths: mod.recert_months,
      totalAttempts: modAttempts.length,
      uniqueWorkersAttempted,
      uniqueWorkersPassed,
      completionRate: workerPassRate,
      averageScore: avgScore
    };
  });

  // 5. calculate mine breakdown
  const mineBreakdown = mines.map((m) => {
    const mineWorkers = workerRoster.filter((w) => w.mineId === m.mine_id);
    const compliant = mineWorkers.filter((w) => w.overallStatus === "compliant").length;
    const rate = mineWorkers.length > 0
      ? Math.round((compliant / mineWorkers.length) * 1000) / 10
      : 0;

    return {
      mineId: m.mine_id,
      name: m.name,
      district: m.district,
      totalWorkers: mineWorkers.length,
      compliantWorkers: compliant,
      complianceRate: rate
    };
  });

  // 6. calculate contractor breakdown
  const contractorBreakdown = contractors.map((c) => {
    const cWorkers = workerRoster.filter((w) => w.contractorId === c.contractor_id);
    const compliant = cWorkers.filter((w) => w.overallStatus === "compliant").length;
    const rate = cWorkers.length > 0
      ? Math.round((compliant / cWorkers.length) * 1000) / 10
      : 0;

    return {
      contractorId: c.contractor_id,
      name: c.name,
      totalWorkers: cWorkers.length,
      compliantWorkers: compliant,
      complianceRate: rate
    };
  });

  // 7. certificate expiration audit
  let expiringSoonCount = 0;
  let expiredCount = 0;
  const certifiedWorkersSet = new Set();

  certificates.forEach((cert) => {
    certifiedWorkersSet.add(cert.worker_id);
    if (cert.expires_at) {
      if (cert.expires_at <= now) {
        expiredCount += 1;
      } else if (cert.expires_at <= thirtyDaysLater) {
        expiringSoonCount += 1;
      }
    }
  });

  // 8. recent activity list
  const recentActivity = attempts.slice(0, 10).map((a) => {
    const w = workers.find((item) => item.worker_id === a.worker_id);
    const m = modules.find((item) => item.module_id === a.module_id);
    return {
      attemptId: a.attempt_id,
      workerId: a.worker_id,
      workerName: w ? w.name : a.worker_id,
      moduleId: a.module_id,
      moduleTitle: m ? m.title : a.module_id,
      serverPercentage: a.server_percentage,
      serverPassed: a.server_passed === 1,
      completedAt: a.completed_at,
      arTier: a.ar_tier,
      locale: a.locale
    };
  });

  // 9. attention items
  const attentionItems = [];
  workerRoster.forEach((w) => {
    if (w.overallStatus === "non_compliant") {
      attentionItems.push({
        type: "training_incomplete",
        severity: "warning",
        workerId: w.workerId,
        workerName: w.name,
        mineName: w.mineName,
        message: "No modules completed yet"
      });
    }
  });

  certificates.forEach((cert) => {
    if (cert.expires_at && cert.expires_at <= now) {
      const w = workers.find((item) => item.worker_id === cert.worker_id);
      attentionItems.push({
        type: "cert_expired",
        severity: "danger",
        workerId: cert.worker_id,
        workerName: w ? w.name : cert.worker_id,
        certId: cert.cert_id,
        moduleId: cert.module_id,
        message: `Certificate expired on ${cert.expires_at}`
      });
    }
  });

  const totalWorkersCount = workers.length;
  const overallComplianceRate = totalWorkersCount > 0
    ? Math.round((fullyCompliantWorkerCount / totalWorkersCount) * 1000) / 10
    : 0;

  return {
    generatedAt: now,
    summary: {
      totalWorkers: totalWorkersCount,
      fullyCompliantWorkers: fullyCompliantWorkerCount,
      partiallyCompliantWorkers: partiallyCompliantWorkerCount,
      nonCompliantWorkers: nonCompliantWorkerCount,
      complianceRate: overallComplianceRate,
      certifiedWorkers: certifiedWorkersSet.size,
      totalAttempts: attempts.length,
      expiringSoonCertificates: expiringSoonCount,
      expiredCertificates: expiredCount,
      certificateSystemStatus: {
        isImplemented: false,
        note: "Certificate cryptographic signing service is pending backend signing key rollout. Completed training passes are tracked authoritatively in the attempt ledger."
      }
    },
    modules: moduleBreakdown,
    mines: mineBreakdown,
    contractors: contractorBreakdown,
    roster: workerRoster,
    recentActivity,
    attentionItems: attentionItems.slice(0, 15)
  };
}

module.exports = { getComplianceMetrics };
