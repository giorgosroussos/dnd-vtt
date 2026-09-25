# 05 — Assets and Images

The shared asset library, how tokens are made from assets, and how uploaded images are processed and stored.

## 1. Asset library

- The asset library MUST be shared by all campaigns: an asset is the template, a token an instance of it on a scene. [input]
- An asset MUST have a name, an image, a category (`pc`, `npc`, `monster`, `object`), a size, free tags and DM notes. [input]
- The library and the token picker MUST support search and filtering: substring search over name and tags, filters by category and by tags (all selected tags must match), sorted by name. [input, Q-064, D-022]

## 2. Token sizes

Token footprint MUST follow the asset's size: [input]

| Size | Footprint |
| --- | --- |
| Tiny | ½ × ½ square |
| Small, Medium | 1 × 1 square |
| Large | 2 × 2 squares |
| Huge | 3 × 3 squares |
| Gargantuan | 4 × 4 squares |

## 3. Tokens

- A token MUST hold only its own state: position, visibility, label and stacking order; name, image, size and category come from its asset. [input]
- Adding several tokens of the same asset to a scene MUST number their labels automatically ("Goblin 1" to "Goblin 4"). [input]
- Numbering MUST be per scene; a single token keeps the bare name, and freed numbers are not reused. [Q-063]
- Only the first token of an asset placed on a scene takes the bare name; a later token of that asset is numbered even when it is alone. The highest number issued for each asset MUST be stored with the scene (`03` §1), so that no number, the highest included, is issued twice on it. [Q-091]
- A token placed hidden MUST take the asset's bare name and no number, and be numbered by these rules only when it is first shown to players, placed visible or revealed; a lone visible token carrying the bare name becomes "<name> 1" only then, so numbering never reveals a hidden token (`04` §4). A label the DM typed is never renumbered. [Q-092]

## 4. Default visibility

- A token MUST start hidden when its asset's `default_hidden` is set, and visible otherwise. [input]
- A new `monster` asset MUST default to hidden and a new `pc` asset to visible. [input]
- A new `npc` or `object` asset MUST default to visible; the DM can change `default_hidden` per asset. [Q-045]

## 5. Adding tokens and deleting assets

- Adding a token MUST follow the flow: an add button, a picker with search and filter, then a click on the map where the token is placed. [input]
- Deleting an asset used by any token MUST be refused, listing the scenes that use it (`03` §7). [input]
- Changing an asset's image MUST update every token of that asset, including on the live scene. [input]

## 6. Upload limits

- Uploads MUST accept only PNG, JPEG and WebP, determined from the file's content and not its extension. [input]
- The maximum upload size MUST be a setting, default 50 MB; larger uploads MUST be rejected before processing. [input, D-044]
- A rejected upload MUST return an error that names the reason (type or size) and store nothing. [Q-035]

## 7. Image processing and storage

- On upload the server MUST produce smaller versions, because battlemaps of 5,000–10,000 px crash phones and TV browsers. [input]
- Each image MUST have three versions: the original (used for calibration), a display version, and a thumbnail for the library. [input]
- Image files MUST be stored in the images folder, named by the sha256 of the original. [input]
- Uploading an image whose sha256 already exists MUST reuse the stored image and its grid preset. [input]
- The display version's long edge is at most the display-size setting (default 4096 px, never upscaled); the thumbnail is 256 px; both are WebP; changing the setting regenerates display versions in the background; files are served at `/images/<sha256>/<variant>` subject to `07` §5. [Q-036, Q-057]
- The display-size default MUST be confirmed on the acceptance TV before the player view is accepted (`10` §4). [input, Q-019]
