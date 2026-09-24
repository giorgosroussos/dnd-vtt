# images

Upload validation and sharp variants (`specs/02-architecture.md` §1, `specs/05-assets-and-images.md` §6, §7, D-080). `detect.ts` judges an upload's type from its first bytes; `store.ts` receives an upload under the size limit into `images/.incoming/`, decodes it in full, writes the WebP display version and thumbnail, and moves the image's folder `images/<sha256>/` into place in one rename. It also removes the files of images nothing references any more and regenerates display versions after the display size changes.
