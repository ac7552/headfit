# Credits and licences

Everything here that came from someone else, and the terms it came under.

| What | From | Licence | Where |
|---|---|---|---|
| Head mesh, eyes, teeth, lashes, the 53 ARKit expression shapes, the 68 landmark and jaw line vertex numbers | ICT-FaceKit, ICT Face Model Light, © 2020 USC Institute for Creative Technologies, <https://github.com/ICT-VGL/ICT-FaceKit> | MIT | `data/ict-head.bin` and `.json` (repacked by `tools/pack_ict.py`), notice in `data/ICT-FaceKit-LICENSE.txt` |
| 3D viewer, orbit controls, glTF export | three.js r170 | MIT | `web/vendor/`, notice in `web/vendor/three-LICENSE.txt` |
| UI font | Inter Tight | SIL Open Font Licence 1.1 | `web/fonts/` |

Left out on purpose: ICT's 100 identity shapes (principal components learned from scans; this project fits faces
by geometry only) and its lacrimal, eye-blend and eye-occlusion meshes (they need Unreal's eye shader).

The sample faces in `web/samples/` are made up by this project (`tools/make_samples.mjs`): the ICT head bent and
painted, not photos of anyone.

This is a record of where things came from, not legal advice.
