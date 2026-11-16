export type ItemKind = 'RAW' | 'INTERMEDIATE' | 'FINAL';

export type ProductCategory = 'FINAL' | 'INTERMEDIATE';

export type TransactionType =
  | 'RECEIPT' // 자재 입고
  | 'PRODUCTION_USE' // 생산 자재 차감
  | 'PRODUCTION_OUTPUT' // 생산 완료 입고 (중간재/완제품)
  | 'PRODUCTION_CANCEL' // 생산 취소 복원/차감
  | 'ADJUSTMENT'; // 재고 실사 조정

export type ActiveTab =
  | 'dashboard'
  | 'production'
  | 'inventory'
  | 'receipts'
  | 'manage';

export interface InventoryItem {
  id: string;
  name: string;
  specification: string;
  unit: string;
  kind: ItemKind;
  currentStock: number; // 현재고
  totalInbound: number; // 입고/생산입고 누계
  totalUsed: number; // 생산 사용 누계
  totalAdjusted: number; // 조정 누적량 (+/-)
  minimumStock: number; // 최소 적정 재고 (주의/부족 기준)
  notes: string;
  active: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  productName: string;
  productCode: string;
  category: ProductCategory; // 'FINAL' | 'INTERMEDIATE'
  unit: string;
  targetQuantity: number; // 목표 생산수량
  linkedItemId: string; // 연결된 InventoryItem id
  active: boolean;
  createdAt: string;
}

export interface BomEntry {
  id: string;
  productId: string;
  materialItemId: string; // InventoryItem id
  quantity: number; // 제품 1EA당 소요 수량
  createdAt: string;
}

export interface ConsumedItemSnapshot {
  itemId: string;
  itemName: string;
  specification: string;
  unit: string;
  quantity: number;
}

export interface ProductionRecord {
  id: string;
  productionDate: string; // YYYY-MM-DD
  productId: string;
  productName: string;
  quantity: number;
  worker: string;
  manager: string;
  note: string;
  consumedItems: ConsumedItemSnapshot[]; // 취소 시 정확한 복원을 위한 스냅샷
  isInitialSeed?: boolean; // 초기 기존 데이터 여부
  createdAt: string;
}

export interface ReceiptRecord {
  id: string;
  receiptDate: string; // YYYY-MM-DD
  itemId: string;
  itemName: string;
  specification: string;
  unit: string;
  quantity: number;
  supplier: string;
  worker: string;
  note: string;
  createdAt: string;
}

export interface InventoryTransaction {
  id: string;
  transactionDate: string; // YYYY-MM-DD
  itemId: string;
  itemName: string;
  transactionType: TransactionType;
  quantityChange: number; // + or -
  balanceAfter: number;
  referenceId: string;
  worker: string;
  note: string;
  createdAt: string;
}

export interface InventoryAdjustment {
  id: string;
  adjustmentDate: string; // YYYY-MM-DD
  itemId: string;
  itemName: string;
  beforeQuantity: number;
  afterQuantity: number;
  adjustmentQuantity: number;
  reason: string;
  worker: string;
  createdAt: string;
}

export interface ErpAppState {
  items: InventoryItem[];
  products: Product[];
  bom: BomEntry[];
  productionRecords: ProductionRecord[];
  receiptRecords: ReceiptRecord[];
  transactions: InventoryTransaction[];
  adjustments: InventoryAdjustment[];
  lastUpdatedAt: string;
}
