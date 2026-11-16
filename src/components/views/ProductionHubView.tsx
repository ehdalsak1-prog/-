import React, { useState } from 'react';
import { PlusCircle, Target } from 'lucide-react';
import { ActiveTab, ErpAppState, ProductionRecord } from '../../types/erp';
import { ProductionEntryView } from './ProductionEntryView';
import { ProductionHistoryView } from './ProductionHistoryView';
import { ProductionPlanView } from './ProductionPlanView';

interface ProductionHubViewProps {
  state: ErpAppState;
  lastSelectedProductId?: string;
  onRegisterProduction: (params: {
    productionDate: string;
    productId: string;
    quantity: number;
    worker: string;
    manager: string;
    note: string;
  }) => { ok: true; record: ProductionRecord } | { ok: false; error: string };
  onCancelProduction: (recordId: string) => void;
  onUpdateProduction: (
    recordId: string,
    updates: {
      productionDate: string;
      quantity: number;
      worker: string;
      manager: string;
      note: string;
    }
  ) => { ok: true } | { ok: false; error: string };
  onUpdateTarget: (productId: string, newTarget: number) => void;
  onUpdateProductName: (productId: string, newName: string) => void;
  onNavigate: (tab: ActiveTab) => void;
  onExportProduction: () => void;
  onExportPlan: () => void;
}

export const ProductionHubView: React.FC<ProductionHubViewProps> = ({
  state,
  lastSelectedProductId,
  onRegisterProduction,
  onCancelProduction,
  onUpdateProduction,
  onUpdateTarget,
  onUpdateProductName,
  onNavigate,
  onExportProduction,
  onExportPlan,
}) => {
  const [subTab, setSubTab] = useState<'work' | 'plan'>('work');

  return (
    <div className="space-y-5">
      {/* 상단 심플 전환 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <button
            type="button"
            onClick={() => setSubTab('work')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition cursor-pointer ${
              subTab === 'work'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <PlusCircle size={15} />
            <span>생산 등록 · 이력 ({state.productionRecords.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('plan')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition cursor-pointer ${
              subTab === 'plan'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Target size={15} />
            <span>목표 수량 설정</span>
          </button>
        </div>
      </div>

      {subTab === 'work' ? (
        <div className="space-y-6">
          <ProductionEntryView
            state={state}
            lastSelectedProductId={lastSelectedProductId}
            onRegisterProduction={onRegisterProduction}
            onNavigate={onNavigate}
          />
          <ProductionHistoryView
            state={state}
            onCancelProduction={onCancelProduction}
            onUpdateProduction={onUpdateProduction}
            onNavigate={onNavigate}
            onExportProduction={onExportProduction}
          />
        </div>
      ) : (
        <ProductionPlanView
          state={state}
          onUpdateTarget={onUpdateTarget}
          onUpdateProductName={onUpdateProductName}
          onExportPlan={onExportPlan}
        />
      )}
    </div>
  );
};
