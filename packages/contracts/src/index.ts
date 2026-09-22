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
  TRANSACTION_TYPES_DTO,
  type FieldProvenanceDto,
  type InventoryItemDetailDto,
  type InventoryItemProvenanceDto,
  type InventoryItemSummaryDto,
  type InventoryItemsResponseDto,
  type InventoryLotDto,
  type InventoryTransactionDto,
  type ProvenanceTierDto,
  type QuantityDto,
  type StorageLocationDto,
  type TransactionActorDto,
  type TransactionTypeDto,
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
