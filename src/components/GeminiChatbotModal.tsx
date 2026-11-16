import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Send,
  X,
  Trash2,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Maximize2,
  Minimize2,
  Database,
  ShieldCheck,
  Boxes,
  HelpCircle,
  FileSpreadsheet,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import { MaterialSheet } from '../App';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

interface GeminiChatbotModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSheet?: MaterialSheet | null;
  allSheets?: MaterialSheet[];
  siteName?: string;
}

// Preset roles with tailored system instructions
const CHATBOT_ROLES = [
  {
    id: 'inspector',
    name: '현장 자재 검수관',
    badge: '품질/규격',
    icon: ShieldCheck,
    description: 'KS 규격, 치수 허용공차, 외관 결함 식별 및 반입 시 필수 확인 항목 전문 안내',
    systemInstruction:
      '당신은 대한민국 건설 및 제조 현장의 20년 경력 최고 전문 자재 검수관입니다. ' +
      '반입되는 철근, 형강, 파이프, 시멘트, 목재, 볼트/너트 등 건설 및 공사 자재의 KS 규격(KSD, KSF 등), ' +
      '현장 반입 검수 체크포인트, 치수 및 오차 검사, 불량품 식별 요령, 밀시트(검사증명서) 대조법을 명확하고 엄격하면서도 실무적으로 알기 쉽게 설명하세요.',
  },
  {
    id: 'safety',
    name: '자재 적재 & 안전 보관관',
    badge: '보관/안전',
    icon: Boxes,
    description: '파레트 적재 높이, 야적장 배수로, 방수·방습 조치 및 산업안전보건 수칙',
    systemInstruction:
      '당신은 대한민국 산업안전보건기준 및 건설 자재 야적 보관 전문 안전관리자입니다. ' +
      '파레트 안전 적재 기준(높이, 결속, 붕괴 방지), 야외 야적장 받침목(침목) 설치, 우천 시 방수포(갑바) 결속, ' +
      '위험물 및 화학물질 분리 보관, 지게차/크레인 양중 시 안전 수칙을 철저하고 구체적으로 지도하세요.',
  },
  {
    id: 'data_analyst',
    name: '대장 데이터 분석가',
    badge: '대장/수량',
    icon: FileSpreadsheet,
    description: '현재 시트의 자재 품목, 수량, 구매처 데이터를 분석하고 누락 및 비고 작성 지원',
    systemInstruction:
      '당신은 건설 공정 및 자재 재고 데이터 분석 전문가입니다. ' +
      '사용자가 제공한 현재 자재 대장의 품목, 규격, 수량, 구매처 정보를 면밀히 분석하여 ' +
      '수량 오기재 가능성, 누락 항목 권고, 비고란에 기재할 모범적인 검수 메모, 자재 집계 통계를 알기 쉽게 정리해 드립니다.',
  },
  {
    id: 'procurement',
    name: '구매·발주 & 전표 어드바이저',
    badge: '발주/거래',
    icon: Sparkles,
    description: '거래명세서, 송장, 세금계산서 검증 요령 및 공급처 납품 체크',
    systemInstruction:
      '당신은 기업 구매/조달 및 거래명세서·송장 검증 전문가입니다. ' +
      '거래명세서와 실제 납품 품목의 대조 요령, 세금계산서 발행 시 확인사항, 공급처별 납기 관리, ' +
      '단가 및 계약 수량 확인 시 주의할 점을 실무적인 노하우를 바탕으로 조언하세요.',
  },
];

// Model options as instructed
const MODEL_OPTIONS = [
  {
    id: 'gemini-3.1-flash-lite',
    name: '초고속 즉답 (gemini-3.1-flash-lite)',
    desc: '대기 시간 없이 즉각 답변 (기본/초고속)',
    badge: '초고속 기본',
  },
  {
    id: 'gemini-3.8-flash',
    name: '일반 자재 상담 (gemini-3.8-flash)',
    desc: '균형 잡힌 표준 답변',
    badge: '표준',
  },
  {
    id: 'gemini-4-argon',
    name: '심층 정밀 분석 (gemini-4-argon)',
    desc: '복잡한 수량 산출 및 공학적 추론',
    badge: '고난도',
  },
];

const QUICK_SUGGESTIONS = [
  '철근 반입 시 현장에서 꼭 확인해야 할 검수 포인트는?',
  '파레트 자재 야외 적재 시 높이 기준과 안전 조치',
  '거래명세서와 송장, 세금계산서의 차이점과 검증법',
  '현재 대장에 등록된 자재 현황과 특이사항을 요약해줘',
];

const CHAT_STORAGE_KEY = 'field_material_gemini_chat_history_v1';

export default function GeminiChatbotModal({
  isOpen,
  onClose,
  activeSheet,
  allSheets,
  siteName,
}: GeminiChatbotModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return [
      {
        id: 'welcome',
        role: 'model',
        content:
          '안녕하세요! **현장 자재 관리 전문 AI 비서 (초고속 응답 모드)**입니다.\n\n' +
          '자재 반입 검수 기준, 규격(KS), 보관 안전 수칙, 거래명세서 대조 등 궁금한 점을 언제든 물어보세요. ' +
          '현재 작업 중인 대장 데이터를 참고하여 지연 없이 즉각 답변해 드립니다.',
        timestamp: Date.now(),
      },
    ];
  });

  const [input, setInput] = useState('');
  const [selectedRole, setSelectedRole] = useState(CHATBOT_ROLES[0].id);
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-lite');
  const [includeContext, setIncludeContext] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages]);

  // Auto-scroll on new message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading]);

  // Auto focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Build context snapshot from active sheet and sheets
  const buildContextData = (): string => {
    if (!includeContext) return '';

    const lines: string[] = [];
    lines.push(`현장/사업부명: ${siteName || '(주)다인_용인사업부'}`);

    if (activeSheet) {
      lines.push(`현재 작업 시트: [${activeSheet.name}] (${activeSheet.subtitle || ''})`);
      lines.push(`등록된 자재 총 ${activeSheet.items.length}건:`);

      const sampleItems = activeSheet.items.slice(0, 30);
      sampleItems.forEach((it, idx) => {
        const parts = [
          `${idx + 1}. ${it.name}`,
          it.spec && it.spec !== '-' ? `규격: ${it.spec}` : '',
          `수량: ${it.quantity} ${it.unit}`,
          it.supplier ? `구매처: ${it.supplier}` : '',
          it.location ? `위치: ${it.location}` : '',
          it.remarks ? `비고: ${it.remarks}` : '',
        ].filter(Boolean);
        lines.push(`  - ${parts.join(' | ')}`);
      });

      if (activeSheet.items.length > 30) {
        lines.push(`  ...외 ${activeSheet.items.length - 30}건 생략`);
      }
    }

    if (allSheets && allSheets.length > 1) {
      lines.push(`전체 시트 목록: ${allSheets.map((s) => s.name).join(', ')}`);
    }

    return lines.join('\n');
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : input).trim();
    if (!text || isLoading) return;

    setErrorMessage(null);
    setInput('');

    const userMessage: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const currentRole = CHATBOT_ROLES.find((r) => r.id === selectedRole);
      const systemInstruction = currentRole ? currentRole.systemInstruction : '';
      const contextData = includeContext ? buildContextData() : '';

      // Prepare history excluding system welcome if necessary or include all user/model turns
      const chatHistory = newMessages
        .filter((m) => m.content && m.content.trim().length > 0)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: chatHistory,
          systemInstruction,
          model: selectedModel,
          contextData,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || '답변을 불러오지 못했습니다.');
      }

      const botMessage: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'model',
        content: data.reply || '답변을 생성하지 못했습니다.',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err: any) {
      console.error('Chat error:', err);
      setErrorMessage(err?.message || 'AI 서버 통신 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    const welcome: ChatMessage = {
      id: `welcome-${Date.now()}`,
      role: 'model',
      content:
        '대화 내용이 초기화되었습니다. 새로운 질문이나 현장 검수 문의를 남겨주세요!',
      timestamp: Date.now(),
    };
    setMessages([welcome]);
    setErrorMessage(null);
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Simple Markdown-like renderer for formatted replies
  const renderMessageContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      // Heading ###
      if (line.startsWith('### ')) {
        return (
          <h4 key={idx} className="font-bold text-sm text-slate-900 mt-2.5 mb-1">
            {line.replace('### ', '')}
          </h4>
        );
      }
      // Heading ##
      if (line.startsWith('## ')) {
        return (
          <h3 key={idx} className="font-bold text-base text-slate-900 mt-3 mb-1.5 border-b border-slate-200 pb-1">
            {line.replace('## ', '')}
          </h3>
        );
      }
      // Bullet list item
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const bulletText = line.substring(2);
        return (
          <div key={idx} className="flex items-start gap-1.5 my-0.5 pl-1 text-slate-800">
            <span className="text-blue-500 font-bold shrink-0">•</span>
            <span>{renderFormattedInline(bulletText)}</span>
          </div>
        );
      }
      // Numbered list item
      const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        return (
          <div key={idx} className="flex items-start gap-1.5 my-0.5 pl-1 text-slate-800">
            <span className="font-semibold text-blue-600 font-mono text-xs shrink-0 w-4">
              {numMatch[1]}.
            </span>
            <span>{renderFormattedInline(numMatch[2])}</span>
          </div>
        );
      }
      // Empty line
      if (!line.trim()) {
        return <div key={idx} className="h-1.5" />;
      }
      // Regular paragraph
      return (
        <p key={idx} className="my-0.5 leading-relaxed text-slate-800">
          {renderFormattedInline(line)}
        </p>
      );
    });
  };

  // Helper for inline **bold** and `code`
  const renderFormattedInline = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={pIdx} className="font-bold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={pIdx} className="px-1.5 py-0.5 rounded bg-slate-100 text-pink-600 font-mono text-[11px]">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  const currentRoleObj = CHATBOT_ROLES.find((r) => r.id === selectedRole) || CHATBOT_ROLES[0];
  const RoleIcon = currentRoleObj.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-200 ${
          isExpanded
            ? 'w-full h-full max-w-6xl max-h-[96vh]'
            : 'w-full max-w-3xl h-[88vh] max-h-[820px]'
        }`}
      >
        {/* Modal Top Header */}
        <div className="px-4 py-3 border-b border-slate-200 bg-linear-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-t-2xl flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300 shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm sm:text-base text-white tracking-tight truncate">
                  AI 자재 상담 비서
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>{selectedModel === 'gemini-3.1-flash-lite' ? 'Gemini 3.1 Flash-Lite (초고속)' : selectedModel}</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate">
                자재 검수 기준 · KS 규격 · 야적 안전 보관 · 수량 및 전표 대조 상담
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleClearChat}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-xs flex items-center gap-1"
              title="대화 내용 지우기"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">초기화</span>
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title={isExpanded ? '창 축소' : '창 최대화'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-1"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-toolbar: Role & Model Selector */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 shrink-0 text-xs">
          {/* Role selector chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap mr-1 flex items-center gap-1">
              <RoleIcon className="w-3.5 h-3.5 text-blue-600" />
              <span>전문가 역할:</span>
            </span>
            {CHATBOT_ROLES.map((role) => {
              const Icon = role.icon;
              const isSelected = selectedRole === role.id;
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRole(role.id)}
                  className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs font-semibold'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                  title={role.description}
                >
                  <Icon className="w-3 h-3" />
                  <span>{role.name}</span>
                </button>
              );
            })}
          </div>

          {/* Model selector & Context toggle */}
          <div className="flex items-center gap-2 ml-auto">
            <label
              className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer select-none bg-white px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50"
              title="현재 보고 계신 대장의 시트명과 등록 품목 목록을 AI에게 함께 전달합니다"
            >
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
              />
              <Database className="w-3 h-3 text-emerald-600" />
              <span>현재 대장 연동</span>
            </label>

            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-[11px] font-medium bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              title="작업에 맞는 Gemini 모델을 선택합니다"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Current Active Sheet Context Banner */}
        {includeContext && activeSheet && (
          <div className="px-4 py-1.5 bg-emerald-50/70 border-b border-emerald-100 flex items-center justify-between text-[11px] text-emerald-900 shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold truncate">
                연동 중: [{activeSheet.name}]
              </span>
              <span className="text-emerald-700">
                (등록 자재 {activeSheet.items.length}건 데이터 참조 가능)
              </span>
            </div>
            <span className="text-[10px] text-emerald-600 shrink-0 font-medium hidden sm:inline">
              "현재 대장 요약해줘" 등으로 질문해보세요
            </span>
          </div>
        )}

        {/* Chat Message Scrollable Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/40">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 text-xs sm:text-sm ${
                  isUser ? 'justify-end' : 'justify-start'
                }`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`relative max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 shadow-xs ${
                    isUser
                      ? 'bg-blue-600 text-white rounded-br-xs'
                      : 'bg-white text-slate-800 border border-slate-200/90 rounded-bl-xs'
                  }`}
                >
                  {/* Message body */}
                  <div className="whitespace-pre-wrap leading-relaxed break-words">
                    {isUser ? msg.content : renderMessageContent(msg.content)}
                  </div>

                  {/* Actions / Timestamp Footer */}
                  <div
                    className={`flex items-center justify-between gap-2 mt-2 pt-1 border-t text-[10px] ${
                      isUser
                        ? 'border-blue-500/40 text-blue-100'
                        : 'border-slate-100 text-slate-400'
                    }`}
                  >
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>

                    {!isUser && (
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                        className="hover:text-blue-600 transition-colors flex items-center gap-1 font-medium"
                        title="답변 복사"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-600">복사됨</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>복사</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-xs font-bold text-xs">
                    나
                  </div>
                )}
              </div>
            );
          })}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex gap-3 text-xs sm:text-sm items-start animate-in fade-in duration-150">
              <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-xs px-4 py-3 shadow-xs flex items-center gap-2.5 text-slate-600">
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-xs font-medium">
                  {currentRoleObj.name}이(가) 답변을 작성하고 있습니다...
                </span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1">
                <span className="font-semibold">오류: </span>
                {errorMessage}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap mr-0.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>추천 질문:</span>
            </span>
            {QUICK_SUGGESTIONS.map((suggestion, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(suggestion)}
                disabled={isLoading}
                className="px-2.5 py-1 bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-slate-200 rounded-full text-[11px] text-slate-600 transition-colors whitespace-nowrap shadow-2xs shrink-0 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Input Textarea & Send Button */}
        <div className="p-3 sm:p-4 bg-white border-t border-slate-200 rounded-b-2xl shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="현장 자재 검수, KS 규격, 안전 적재, 또는 대장 데이터에 대해 질문해주세요... (Enter 전송 / Shift+Enter 줄바꿈)"
                rows={2}
                disabled={isLoading}
                className="w-full resize-none text-xs sm:text-sm px-3.5 py-2.5 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 leading-relaxed disabled:opacity-60"
              />
            </div>

            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="h-[52px] px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-xs"
              title="메시지 전송"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">전송</span>
            </button>
          </form>

          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 px-1">
            <span>
              💡 팁: '철근 규격', '파레트 적재 높이', '송장 검수' 등 현장 용어로 자유롭게 질문하세요.
            </span>
            <span className="font-mono">
              Role: {currentRoleObj.badge} | Model: {selectedModel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
