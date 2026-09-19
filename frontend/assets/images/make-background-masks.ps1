# Rebuilds every prerequisite equipment asset in this folder from the photographs
# supplied in `2d images/` at the repository root. Deterministic: run it twice and
# the files are byte-identical.
#
# Two things happen here.
#
# 1. DERIVE. Most photographs are copied byte-identical, because re-encoding one
#    throws image quality away for nothing. Two are not: the gas detector render is
#    3680x1120 and 5.4 MB and holds four views of the device, and the harness is
#    2560x2560 and 714 KB for something that is drawn about 225 css px wide. A mine
#    phone precaches all of this to work underground, so those two are cropped to the
#    view actually used and scaled to the size actually drawn. The originals in
#    `2d images/` are never touched.
#
# 2. MASK. Every photograph was shot on a plain background — white paper for the
#    equipment, black for the detector render. The UI puts the equipment on the app's
#    own dark background with no plate or card behind it, so the backdrop must not be
#    painted. Rather than punching an alpha channel into each photograph, each one
#    gets a mask beside it: a png whose alpha is the object's outline and whose colour
#    channels are empty. The UI masks the photograph with it in CSS.
#
#    The mask is derived from the photograph's own pixels: flood-fill the backdrop
#    inward from the border, so a colour that matches it INSIDE the object survives
#    (the extinguisher's printed label, the detector's black screen bezel); cut the
#    enclosed holes that are large enough to be real holes — the gap inside the hose
#    loop, the bore of the O-ring, the gaps between the harness straps — while leaving
#    the small enclosed patches alone, because those are specular highlights; erode a
#    pixel to take the encoding fringe off; blur to give the edge its antialiasing back.
#
# Run from anywhere:  powershell -File make-background-masks.ps1
# Only re-run it when a photograph is replaced.

Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;

public class EquipmentAsset
{
    // crop/scale a supplied photograph down to the view and size the app actually draws
    public static string Derive(string src, string dst, int cx, int cy, int cw, int ch, int outW, long quality)
    {
        Bitmap bmp = new Bitmap(src);
        if (cw <= 0) { cx = 0; cy = 0; cw = bmp.Width; ch = bmp.Height; }
        int outH = (int)Math.Round(outW * (ch / (double)cw));

        Bitmap outBmp = new Bitmap(outW, outH, PixelFormat.Format24bppRgb);
        using (Graphics g = Graphics.FromImage(outBmp))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.DrawImage(bmp, new Rectangle(0, 0, outW, outH), new Rectangle(cx, cy, cw, ch), GraphicsUnit.Pixel);
        }
        bmp.Dispose();

        ImageCodecInfo jpeg = null;
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders())
            if (c.MimeType == "image/jpeg") jpeg = c;
        EncoderParameters ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        outBmp.Save(dst, jpeg, ep);
        outBmp.Dispose();
        return outW + "x" + outH;
    }

    // the silhouette, as an alpha-only png beside the photograph
    public static string Mask(string src, string dst, string mode, int limit, int satMax, int erode, bool cutHoles)
    {
        Bitmap bmp = new Bitmap(src);
        int W = bmp.Width, H = bmp.Height;
        Bitmap rgb = new Bitmap(W, H, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(rgb)) { g.DrawImage(bmp, 0, 0, W, H); }
        bmp.Dispose();

        BitmapData bd = rgb.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = bd.Stride;
        byte[] px = new byte[stride * H];
        System.Runtime.InteropServices.Marshal.Copy(bd.Scan0, px, 0, px.Length);
        rgb.UnlockBits(bd);
        rgb.Dispose();

        // 1. which pixels LOOK like the backdrop
        bool[] backdrop = new bool[W * H];
        for (int y = 0; y < H; y++)
        {
            for (int x = 0; x < W; x++)
            {
                int o = y * stride + x * 4;
                int b = px[o], gg = px[o + 1], r = px[o + 2];
                int mn = Math.Min(r, Math.Min(gg, b));
                int mx = Math.Max(r, Math.Max(gg, b));
                backdrop[y * W + x] = mode == "dark"
                    ? (mx <= limit)
                    : (mn >= limit && (mx - mn) <= satMax);
            }
        }

        // 2. flood fill inward from the border, so backdrop colour INSIDE the object survives
        bool[] outside = new bool[W * H];
        Queue<int> q = new Queue<int>();
        for (int x = 0; x < W; x++)
        {
            if (backdrop[x] && !outside[x]) { outside[x] = true; q.Enqueue(x); }
            int i = (H - 1) * W + x;
            if (backdrop[i] && !outside[i]) { outside[i] = true; q.Enqueue(i); }
        }
        for (int y = 0; y < H; y++)
        {
            int i = y * W;
            if (backdrop[i] && !outside[i]) { outside[i] = true; q.Enqueue(i); }
            int j = y * W + (W - 1);
            if (backdrop[j] && !outside[j]) { outside[j] = true; q.Enqueue(j); }
        }
        int[] dx = { 1, -1, 0, 0 };
        int[] dy = { 0, 0, 1, -1 };
        while (q.Count > 0)
        {
            int i = q.Dequeue();
            int cy = i / W, cx = i % W;
            for (int k = 0; k < 4; k++)
            {
                int nx = cx + dx[k], ny = cy + dy[k];
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                int ni = ny * W + nx;
                if (outside[ni] || !backdrop[ni]) continue;
                outside[ni] = true;
                q.Enqueue(ni);
            }
        }

        // 2b. real holes the flood cannot reach — the gap inside the hose loop, the
        // bore of a ring, the gaps between harness straps — cut those too, but only
        // above an area threshold, because the small enclosed patches are specular
        // highlights and punching those out puts pin-holes through the metal
        // A render shot on black has black inside it — the screen, the vents, the
        // button recesses — and the biggest enclosed region in the detector IS its
        // display. Cutting enclosed regions there punches the device full of holes,
        // so it is only ever done against a white backdrop, where a gap really is
        // the paper showing through.
        int holeMin = cutHoles ? (int)(0.0008 * W * H) : int.MaxValue;
        int[] lab = new int[W * H];
        int nextLab = 0;
        int holes = 0;
        for (int sy = 0; sy < H; sy++)
        {
            for (int sx = 0; sx < W; sx++)
            {
                int si = sy * W + sx;
                if (!backdrop[si] || outside[si] || lab[si] != 0) continue;
                nextLab++;
                List<int> cell = new List<int>();
                Queue<int> hq = new Queue<int>();
                hq.Enqueue(si); lab[si] = nextLab;
                while (hq.Count > 0)
                {
                    int i = hq.Dequeue();
                    cell.Add(i);
                    int cy2 = i / W, cx2 = i % W;
                    for (int k = 0; k < 4; k++)
                    {
                        int nx = cx2 + dx[k], ny = cy2 + dy[k];
                        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                        int ni = ny * W + nx;
                        if (!backdrop[ni] || outside[ni] || lab[ni] != 0) continue;
                        lab[ni] = nextLab; hq.Enqueue(ni);
                    }
                }
                if (cell.Count < holeMin) continue;
                holes++;
                foreach (int i in cell) outside[i] = true;
            }
        }

        // 3. object = everything the flood could not reach
        float[] a = new float[W * H];
        int solid = 0;
        for (int i = 0; i < W * H; i++) { a[i] = outside[i] ? 0f : 1f; if (a[i] > 0) solid++; }

        // 4. erode, which eats the pale encoding fringe that rings every edge
        for (int pass = 0; pass < erode; pass++)
        {
            float[] e = new float[W * H];
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    int i = y * W + x;
                    if (a[i] == 0f) { e[i] = 0f; continue; }
                    bool edge = false;
                    for (int k = 0; k < 4 && !edge; k++)
                    {
                        int nx = x + dx[k], ny = y + dy[k];
                        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge = true; break; }
                        if (a[ny * W + nx] == 0f) edge = true;
                    }
                    e[i] = edge ? 0f : 1f;
                }
            }
            a = e;
        }

        // 5. two box blurs, which is what turns a jagged cut-out into a clean edge
        for (int pass = 0; pass < 2; pass++)
        {
            float[] b2 = new float[W * H];
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    float sum = 0f; int n = 0;
                    for (int oy = -1; oy <= 1; oy++)
                    {
                        int ny = y + oy; if (ny < 0 || ny >= H) continue;
                        for (int ox = -1; ox <= 1; ox++)
                        {
                            int nx = x + ox; if (nx < 0 || nx >= W) continue;
                            sum += a[ny * W + nx]; n++;
                        }
                    }
                    b2[y * W + x] = sum / n;
                }
            }
            a = b2;
        }

        // 6. write it out: black pixels, alpha = the silhouette
        Bitmap outBmp = new Bitmap(W, H, PixelFormat.Format32bppArgb);
        BitmapData od = outBmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        int ostride = od.Stride;
        byte[] op = new byte[ostride * H];
        for (int y = 0; y < H; y++)
        {
            for (int x = 0; x < W; x++)
            {
                int o = y * ostride + x * 4;
                float v = a[y * W + x];
                if (v < 0f) v = 0f; if (v > 1f) v = 1f;
                op[o] = 0; op[o + 1] = 0; op[o + 2] = 0;
                op[o + 3] = (byte)Math.Round(v * 255f);
            }
        }
        System.Runtime.InteropServices.Marshal.Copy(op, 0, od.Scan0, op.Length);
        outBmp.UnlockBits(od);
        outBmp.Save(dst, ImageFormat.Png);
        outBmp.Dispose();

        double pct = 100.0 * solid / (W * H);
        return W + "x" + H + " object=" + pct.ToString("F1") + "% holes=" + holes;
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$out = $PSScriptRoot
$src = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\2d images")

# name in this folder | supplied original | how it gets here | backdrop
#
# `copy` ships the supplied file byte-identical. `crop`/`width` derive a smaller one,
# and are used only where the supplied file is far larger than anything drawn from it.
$assets = @(
  @{ out = "fire-extinguisher.jpeg";            from = "fireextinguisher.jpeg"; copy = $true; bg = "white"; limit = 238; sat = 14 },
  @{ out = "fire-extinguisher-valve-kit.jpg";   from = "valve.jpg";             copy = $true; bg = "white"; limit = 234; sat = 16 },
  @{ out = "fire-extinguisher-safety-pin.jpeg"; from = "safteypin.jpeg";        copy = $true; bg = "white"; limit = 236; sat = 14 },
  @{ out = "fire-extinguisher-hose.jpg";        from = "hose.jpg";              copy = $true; bg = "white"; limit = 236; sat = 14 },
  @{ out = "fire-extinguisher-nozzle.jpg";      from = "nozzle.jpg";            copy = $true; bg = "white"; limit = 236; sat = 14 },
  @{ out = "gas-scba.png";                      from = "breathe.png";           copy = $true; bg = "white"; limit = 248; sat = 10 },
  # 2560x2560 for something drawn 225 css px wide
  @{ out = "gas-harness.jpg";  from = "haarness.jpg";          width = 1400; quality = 82; bg = "white"; limit = 236; sat = 14 },
  # Four views of the device in one 3680x1120 render; only the hero view is used, and
  # it is cropped SQUARE around the device. The stage draws a photograph inside a
  # square box, so a square source maps one-to-one and a callout anchor measured on
  # the photograph lands on the same pixel on screen. A 655x990 crop would be
  # letterboxed and every anchor would sit off the part it points at.
  @{ out = "gas-detector.jpg"; from = "mutligas detector.png"; crop = @(430, 70, 990, 990); width = 990; quality = 92; bg = "dark"; limit = 34; sat = 0 }
)

foreach ($a in $assets) {
  $source = Join-Path $src $a.from
  $target = Join-Path $out $a.out
  $note = ""

  if ($a.copy) {
    Copy-Item -LiteralPath $source -Destination $target -Force
    $note = "copied byte-identical"
  } else {
    $c = if ($a.ContainsKey("crop")) { $a.crop } else { @(0, 0, 0, 0) }
    $size = [EquipmentAsset]::Derive($source, $target, $c[0], $c[1], $c[2], $c[3], $a.width, [long]$a.quality)
    $note = "derived -> $size q$($a.quality)"
  }

  $erode = 1
  $cutHoles = -not ($a.bg -eq "dark")
  $maskPath = Join-Path $out ([System.IO.Path]::GetFileNameWithoutExtension($a.out) + ".mask.png")
  $info = [EquipmentAsset]::Mask($target, $maskPath, $a.bg, $a.limit, $a.sat, $erode, $cutHoles)

  $imgKb = [math]::Round((Get-Item $target).Length / 1KB)
  $maskKb = [math]::Round((Get-Item $maskPath).Length / 1KB)
  Write-Output ("{0,-38} {1,-26} {2}  img={3}KB mask={4}KB" -f $a.out, $note, $info, $imgKb, $maskKb)
}
