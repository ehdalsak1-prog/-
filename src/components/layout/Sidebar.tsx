import React from 'react';
import {
  LayoutDashboard,
  Hammer,
  Package,
  Truck,
  Settings2,
  X,
  Factory,
} from 'lucide-react';
import { ActiveTab } from '../../types/erp';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  shortageCount: number;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  shortageCount,
  isOpenMobile,
  onCloseMobile,
}) => {
  const navItems: {
    id: ActiveTab;
    name: string;
    desc: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    {
      id: 'dashboard',
      name: '대시보드',
      desc: '전체 현황 한눈에',
      icon: <LayoutDashboard size={18} />,
    },
    {
      id: 'production',
      name: '생산 관리',
      desc: '생산 등록 · 이력 · 목표',
      icon: <Hammer size={18} />,
    },
    {
      id: 'inventory',
      name: '자재 · 재고',
      desc: '재고 · 자재추가 · 발주',
      icon: <Package size={18} />,
      badge: shortageCount > 0 ? shortageCount : undefined,
    },
    {
      id: 'receipts',
      name: '자재 입고',
      desc: '입고 등록 · 내역',
      icon: <Truck size={18} />,
    },
    {
      id: 'manage',
      name: '설정 · 엑셀',
      desc: 'BOM · 수불부 · 다운로드',
      icon: <Settings2 size={18} />,
    },
  ];

  const handleClick = (tab: ActiveTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  return (
    <>
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`no-print fixed lg:sticky top-0 left-0 z-50 lg:z-30 h-screen w-60 bg-white dark:bg-[#1E232D] border-r border-slate-200/90 dark:border-slate-800 flex flex-col shrink-0 transition-transform duration-200 ease-out ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => handleClick('dashboard')}
            className="flex items-center space-x-2.5 text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 flex items-center justify-center shrink-0">
              <Factory size={17} />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                DAIN 40A POST
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                자재 · 생산관리
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Simplified 5-Item Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left transition cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-2xs'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <span
                        className={
                          isActive
                            ? 'text-white dark:text-slate-900 shrink-0'
                            : 'text-slate-400 dark:text-slate-500 shrink-0'
                        }
                      >
                        {item.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate">{item.name}</div>
                        <div
                          className={`text-[11px] truncate ${
                            isActive
                              ? 'text-slate-300 dark:text-slate-600'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {item.desc}
                        </div>
                      </div>
                    </div>

                    {item.badge !== undefined && (
                      <span
                        className={`text-[11px] font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ml-2 ${
                          isActive
                            ? 'bg-rose-500 text-white'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-3.5 border-t border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500">
          브라우저 자동 저장됨
        </div>
      </aside>
    </>
  );
};
