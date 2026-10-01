import { createHmac } from 'node:crypto';

// Stable for one anonymous cookie, without exposing its value or retaining another identifier.
const species = [
  'Ailuropoda melanoleuca', 'Ambystoma mexicanum', 'Anas platyrhynchos', 'Ara macao',
  'Balaenoptera musculus', 'Bombus terrestris', 'Canis lupus', 'Chelonia mydas',
  'Danaus plexippus', 'Delphinus delphis', 'Elephas maximus', 'Felis catus',
  'Ginkgo biloba', 'Haliaeetus leucocephalus', 'Hippocampus hippocampus', 'Lynx lynx',
  'Octopus vulgaris', 'Panthera onca', 'Pavo cristatus', 'Pseudorca crassidens',
  'Rangifer tarandus', 'Salmo salar', 'Tachyglossus aculeatus', 'Ursus arctos',
  'Vulpes vulpes', 'Zea mays',
] as const;

export function scientificAlias(secret: string, session: string, shareId: string) {
  const digest = createHmac('sha256', secret).update(`alias:${shareId}:${session}`).digest();
  return species[digest.readUInt32BE(0) % species.length]!;
}
