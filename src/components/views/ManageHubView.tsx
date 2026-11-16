import React, { useState } from 'react';
import { Layers, BookOpen, FileSpreadsheet } from 'lucide-react';
import { ErpAppState, ItemKind, ProductCategory } from '../../types/erp';
import { ExportDataView } from './ExportDataView';
import { LedgerView } from './LedgerView';
import { ProductsBomView } from './ProductsBomView';

interface ManageHubViewProps {
  state: ErpAppState;
  onAddBomLine: (productId: string, materialItemId: string, quantity: number) => void;
  onUpdateBomQty: (bomId: string, quantity: number) => void;
  onDeleteBomLine: (bomId: string) => void;
  onAddMaterial: (params: {
    name: string;
    specification: string;
    unit: string;
    kind: ItemKind;
    initialStock: number;
    minimumStock: number;
    notes: string;
  }) => string;
  onAddProduct: (params: {
    productName: string;
    category: ProductCategory;
    unit: string;
    targetQuantity: number;
  }) => void;
  onUpdateProductName: (productId: string, newName: string) => void;
  onDeleteProduct: (productId: string) => void;
  onResetToInitial: () => void;
  onExportBom: () => void;
  onExportLedger: () => void;
}

export const ManageHubView: React.FC<ManageHubViewProps> = ({
  state,
  onAddBomLine,
  onUpdateBomQty,
  onDeleteBomLine,
  onAddMaterial,
  onAddProduct,
  onUpdateProductName,
  onDeleteProduct,
  onResetToInitial,
  onExportBom,
  onExportLedger,
}) => {
  const [subTab, setSubTab] = useState<'products-bom' | 'ledger' | 'export'>('products-bom');

  const tabs = [
    { id: 'products-bom' as const, label: '제품 · BOM 관리', icon: <Layers size={15} /> },
    { id: 'ledger' as const, label: '재고 수불부', icon: <BookOpen size={15} /> },
    { id: 'export' as const, label: '엑셀 · 초기화', icon: <FileSpreadsheet size={15} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="inline-flex flex-wrap p-1 rounded-xl bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 shadow-2xs gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition cursor-pointer ${
              subTab === t.id
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {subTab === 'products-bom' && (
        <ProductsBomView
          state={state}
          onAddProduct={onAddProduct}
          onUpdateProductName={onUpdateProductName}
          onDeleteProduct={onDeleteProduct}
          onAddBomLine={onAddBomLine}
          onUpdateBomQty={onUpdateBomQty}
          onDeleteBomLine={onDeleteBomLine}
          onAddMaterial={onAddMaterial}
          onExportBom={onExportBom}
        />
      )}

      {subTab === 'ledger' && (
        <LedgerView state={state} onExportLedger={onExportLedger} />
      )}

      {subTab === 'export' && (
        <ExportDataView state={state} onResetToInitial={onResetToInitial} />
      )}
    </div>
  );
};
