# Catalog header action alignment

Purpose: keep Master Catalog actions grouped on the right side of the header.

Final UI behavior:
- Title/subtitle remain on the left.
- `+ New Product` and `Barcode & Labels` render together as one right-aligned action group.
- Barcode button legacy left margin is neutralized inside the group so spacing is controlled by one 12px gap.

Validation:
- `npm ci` PASS.
- `npm run build` PASS.
- `git diff --check` PASS.
- Source and dist mirrors contain the same scoped header-action change.
