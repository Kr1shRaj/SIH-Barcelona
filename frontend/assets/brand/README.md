# SafeAR brand assets

The logo is the source of truth for the product's identity. It is not redrawn, not
recoloured, and not replaced by an icon, an emoji or a wordmark set in type.

## Files

| File | What it is |
|---|---|
| `safear-logo-source.png` | The supplied logo, byte for byte. 512 × 156, RGB, no alpha, white background. Never edit this file. |
| `safear-logo.png` | What the app renders. The source, cropped to the bounding box of its own ink — nothing scaled, recoloured or redrawn. 471 × 112. |

The derived file exists for one reason: the supplied image carries 12–25px of white
margin, which is the file's padding rather than a design decision. Cropping to the
ink lets the stylesheet set the clear space, so the mark sits identically on the
loading screen and on the language screen instead of drifting by whatever margin the
export happened to have.

Regenerate it from the source with:

```
python -c "from PIL import Image, ImageChops; im=Image.open('safear-logo-source.png').convert('RGB'); bg=Image.new('RGB', im.size, (255,255,255)); d=ImageChops.difference(im,bg).convert('L').point(lambda v: 255 if v>12 else 0); im.crop(d.getbbox()).save('safear-logo.png', optimize=True)"
```

## Colours

Sampled from the source file, and the two brand values in `css/style.css` are these
exactly:

| Role | Value | Where it is in the logo |
|---|---|---|
| Brand navy | `#01172e` | the "Safe" letterforms |
| Safety yellow | `#febc04` | the hard hat and the "AR" |

## How it is presented

The mark is navy on white and has no transparency. The product's ground is graphite,
where navy letterforms would disappear.

Two things were deliberately **not** done: the mark was not recoloured to sit on a
dark ground, because that would make it a different logo; and the white was not keyed
out to transparency, because anti-aliased navy edges against graphite leave a pale
halo around every letter.

Instead the logo keeps the white surface it was drawn for — a plate with controlled
clear space (`.splash__plate`, `.lang-brand__plate`). On graphite that reads as the
nameplate on a piece of equipment, which suits a safety trainer.

## Known limitation

The supplied file is 512px wide, so it is displayed at no more than ~240 CSS px and
never upscaled. On a 3× phone that is slightly under one device pixel per image
pixel at the largest size. A vector original (SVG/PDF/AI) would render sharply at any
size and is worth having if one exists; drop it in beside these and point
`BRAND_LOGO` in `screens/splash.js` and `screens/language.js` at it.
