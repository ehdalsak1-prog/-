import React from 'react';
import {
  Menu,
  Moon,
  Sun,
  PlusCircle,
  FileSpreadsheet,
  Truck,
} from 'lucide-react';
import { ActiveTab } from '../../types/erp';

interface TopHeaderProps {
  activeTab: ActiveTab;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenMobileMenu: () => void;
  onQuickNavigate: (tab: ActiveTab) => void;
  onQuickExportAll: () => void;
}

const TAB_TITLES: Record<ActiveTab, string> = {
  dashboard: '대시보드 (종합 현황)',
  production: '생산 관리 (등록 · 이력 · 목표)',
  inventory: '자재 · 재고 관리',
  receipts: '자재 입고 관리',
  manage: '설정 · 수불부 · 엑셀',
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  isDarkMode,
  onToggleDarkMode,
  onOpenMobileMenu,
  onQuickNavigate,
  onQuickExportAll,
}) => {
  return (
    <header className="no-print sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#1E232D]/95 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center space-x-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
          aria-label="메뉴 열기"
        >
          <Menu size={20} />
        </button>

        <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
          {TAB_TITLES[activeTab]}
        </h1>
      </div>

      <div className="flex items-center space-x-2 shrink-0">
        <button
          type="button"
          onClick={() => onQuickNavigate('receipts')}
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 transition cursor-pointer whitespace-nowrap"
        >
          <Truck size={15} className="text-slate-500" />
          <span>자재 입고</span>
        </button>

        <button
          type="button"
          onClick={() => onQuickNavigate('production')}
          className="flex items-center space-x-1.5 px-3 sm:px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 transition shadow-2xs cursor-pointer whitespace-nowrap"
        >
          <PlusCircle size={15} />
          <span>생산 등록</span>
        </button>

        <button
          type="button"
          onClick={onQuickExportAll}
          className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 transition cursor-pointer whitespace-nowrap"
          title="전체 통합 엑셀 다운로드"
        >
          <FileSpreadsheet size={15} className="text-emerald-600 dark:text-emerald-400" />
          <span>엑셀</span>
        </button>

        <button
          type="button"
          onClick={onToggleDarkMode}
          className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          title={isDarkMode ? '라이트 모드로 전환' : '다크 모드로 전환'}
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
};
