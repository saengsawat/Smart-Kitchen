// Populated as API/schema types are needed by client + server.
export const CONTRACTS_PACKAGE_NAME = "@smart-kitchen/contracts";

export {
  API_ERROR_CODES,
  CORRELATION_ID_HEADER,
  type ApiErrorBodyDto,
  type ApiErrorCode,
} from "./errors.js";
export {
  INVENTORY_ITEMS_PATH,
  type FieldProvenanceDto,
  type InventoryItemProvenanceDto,
  type InventoryItemSummaryDto,
  type InventoryItemsResponseDto,
  type InventoryLotDto,
  type ProvenanceTierDto,
  type QuantityDto,
  type StorageLocationDto,
} from "./inventory.js";
// M3-T1's client-side placeholder types. Superseded by the `…Dto` types above;
// still exported because `apps/mobile` and the adapters' inventory fixtures use
// them. See the supersession note in inventory.ts.
export type {
  InventoryItemSummary,
  InventoryProvenanceTier,
  InventoryQuantitySummary,
  InventoryStorageLocation,
} from "./inventory.js";
export {
  MAJOR_ALLERGEN_CODES_DTO,
  MAJOR_ALLERGEN_LABELS_DTO,
  type HouseholdDto,
  type HouseholdRoleDto,
  type MajorAllergenCodeDto,
  type MemberDto,
  type MemberRestrictionDto,
  type OnboardingStateDto,
  type RestrictionSeverityDto,
} from "./household.js";
