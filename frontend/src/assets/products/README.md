Place your product catalog images in this folder.

The frontend uses optimized `.webp` assets for runtime performance. Keep your source files as
`.png`/`.jpg`, then run:

`npm run assets:optimize`

This generates `.webp` files that the app consumes directly.

The resolver maps these product names/SKUs to media:

- `basmati-rice-5kg.png`
- `beef-strips.png`
- `bottled-water-24pk.png`
- `bread-loaf.png`
- `butter-spread.png`
- `cassava-flour.png`
- `coke-pack.png`
- `cooking-salt.png`
- `egg-tray.png`
- `frozen-chicken.png`
- `groundnut-mix.png`
- `jollof-rice-mix.png`
- `meat-pie-pack.png`
- `milk-powder.png`
- `milo-tin.png`
- `orange-juice.png`
- `palm-oil.png`
- `peanut-butter.png`
- `plantain-chips.png`
- `semolina-flour.png`
- `sugar-2kg.png`
- `tomato-paste.png`

Recommended source images:

- square images
- soft white background
- centered product
- consistent lighting and angle
- PNG or JPG (WebP is generated automatically)

If an image is missing, the app falls back to the shared placeholder image.
