// Test-only placement order: reserve scarce desk space for desk-only furniture before
// flexible desk/floor items. Keep the catalog unchanged and exercise native add controls.
export function housingFurnitureOrder(items) {
  const deskOnly = item => Number(item.surfaces.length === 1 && item.surfaces[0] === "desk");
  return items.toSorted((a, b) => deskOnly(b) - deskOnly(a));
}
