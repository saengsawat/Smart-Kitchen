// Populated as API/schema types are needed by client + server.
export const CONTRACTS_PACKAGE_NAME = "@smart-kitchen/contracts";

export {
  API_ERROR_CODES,
  CORRELATION_ID_HEADER,
  LEDGER_ERROR_CODES_DTO,
  type ApiErrorBodyDto,
  type ApiErrorCode,
  type LedgerErrorCodeDto,
} from "./errors.js";
export {
  INVENTORY_ITEM_ROUTE,
  INVENTORY_ITEM_TRANSACTIONS_ROUTE,
  INVENTORY_ITEMS_PATH,
  INVENTORY_TRANSACTION_UNDO_ROUTE,
  INVENTORY_WRITE_TYPES_DTO,
  TRANSACTION_TYPES_DTO,
  inventoryItemPath,
  inventoryItemTransactionsPath,
  inventoryTransactionUndoPath,
  type FieldProvenanceDto,
  type InventoryItemDetailDto,
  type InventoryItemProvenanceDto,
  type InventoryItemSummaryDto,
  type InventoryItemsResponseDto,
  type InventoryLotDto,
  type InventoryTransactionDto,
  type InventoryWriteRequestDto,
  type InventoryWriteResponseDto,
  type InventoryWriteTypeDto,
  type ProvenanceTierDto,
  type QuantityDto,
  type StorageLocationDto,
  type TransactionActorDto,
  type TransactionTypeDto,
  type UndoRequestDto,
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
