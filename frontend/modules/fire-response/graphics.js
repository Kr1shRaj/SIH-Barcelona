// build fire graphic element: stacked flame SVG shapes, red-orange gradient
// returns a DOM div with id "fire-graphic" — real bounding rect for aim accuracy calc
function buildFireGraphic() {
  const wrap = document.createElement("div");
  wrap.id = "fire-graphic";
  wrap.style.cssText = [
    "position:absolute", "top:30%", "left:50%",
    "transform:translateX(-50%)",
    "width:80px", "height:100px",
    "cursor:crosshair", "user-select:none",
    // drop shadow to make it pop against camera feed
    "filter:drop-shadow(0 0 10px rgba(255,80,0,0.8))"
  ].join(";");

  // inline SVG fire shape — three overlapping flame teardrops
  // placeholder art: clearly communicates "fire" without final sourced imagery
  wrap.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 100"
         width="80" height="100" aria-label="Fire hazard — aim extinguisher at base">
      <defs>
        <radialGradient id="flame-grad" cx="50%" cy="70%" r="60%">
          <stop offset="0%"   stop-color="#fff200"/>
          <stop offset="35%"  stop-color="#ff6a00"/>
          <stop offset="75%"  stop-color="#cc1800"/>
          <stop offset="100%" stop-color="#6b0000"/>
        </radialGradient>
      </defs>
      <!-- main flame body -->
      <path d="M40 100 C10 100 0 75 8 55 C14 40 22 38 20 20
               C30 35 28 45 40 40 C52 45 50 35 60 20
               C58 38 66 40 72 55 C80 75 70 100 40 100Z"
            fill="url(#flame-grad)"/>
      <!-- inner bright core -->
      <path d="M40 90 C25 90 18 75 24 62 C28 53 34 52 33 42
               C40 52 46 48 47 38 C53 52 57 53 56 62
               C62 75 55 90 40 90Z"
            fill="#fff176" opacity="0.7"/>
      <!-- base glow bar — this is the aim target (bottom of graphic) -->
      <ellipse cx="40" cy="97" rx="22" ry="4" fill="#ff3300" opacity="0.6"/>
    </svg>
  `;

  return wrap;
}

// build exit graphic element: green directional arrow + EXIT label
// returns a DOM div with id "exit-graphic" — positioned top-right of viewport
function buildExitGraphic() {
  const wrap = document.createElement("div");
  wrap.id = "exit-graphic";
  wrap.style.cssText = [
    "position:absolute", "top:12%", "right:8%",
    "width:110px", "height:80px",
    "pointer-events:none", "user-select:none",
    "filter:drop-shadow(0 2px 8px rgba(0,200,100,0.6))"
  ].join(";");

  // inline SVG exit sign: green box, white arrow, "EXIT" text
  // placeholder art: ISO 7010 E001 inspired layout, not sourced licensed art
  wrap.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 80"
         width="110" height="80" aria-label="Emergency exit — move toward this direction">
      <!-- green background panel -->
      <rect width="110" height="80" rx="8" ry="8" fill="#00a651"/>
      <!-- running person silhouette (simplified) -->
      <g fill="#fff">
        <!-- head -->
        <circle cx="30" cy="16" r="7"/>
        <!-- body leaning forward -->
        <path d="M24 24 L18 48 L28 48 L30 36 L36 42 L42 36 L34 24Z"/>
        <!-- leg 1 -->
        <path d="M20 48 L14 66 L22 66 L26 54Z"/>
        <!-- leg 2 -->
        <path d="M28 48 L30 66 L38 66 L34 52Z"/>
      </g>
      <!-- door opening (white rectangle) -->
      <rect x="45" y="18" width="16" height="44" rx="2" fill="#fff"/>
      <!-- directional arrow -->
      <g fill="#fff">
        <polygon points="68,36 68,44 90,44 90,52 108,40 90,28 90,36"/>
      </g>
      <!-- EXIT label -->
      <text x="55" y="75" font-family="Arial,sans-serif" font-size="9"
            font-weight="bold" fill="#fff" text-anchor="middle">EXIT</text>
    </svg>
  `;

  return wrap;
}

export { buildFireGraphic, buildExitGraphic };
