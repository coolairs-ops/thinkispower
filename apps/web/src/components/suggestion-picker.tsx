'use client';

import { useState } from 'react';

interface SuggestionPickerProps {
 question: string;
 options: string[];
 onPick: (value: string) => void;
 onSkip: () => void;
 loading?: boolean;
}

/** 对话式引导选择器：问题 + 选项按钮 + 自定义输入 */
export default function SuggestionPicker({
 question,
 options,
 onPick,
 onSkip,
 loading = false,
}: SuggestionPickerProps) {
 const [custom, setCustom] = useState('');
 const [showCustom, setShowCustom] = useState(false);

 if (!question && !loading) return null;

 return (
 <div className=" rounded-2xl bg-white -xl border border-gray-200 p-5">
 {/* 问题 */}
 <div className="flex items-start gap-3 mb-4">
 <span className="mt-0.5 text-lg">🤖</span>
 <div className="flex-1">
 <p className="text-gray-900 font-medium">
 {loading ? '分析中...' : question}
 </p>
 {loading && (
 <div className="mt-2 flex gap-1">
 <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
 <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
 <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
 </div>
 )}
 </div>
 </div>

 {/* 选项按钮 */}
 {!loading && options.length > 0 && (
 <div className="flex flex-wrap gap-2 mb-3">
 {options.map((opt) => (
 <button
 key={opt}
 onClick={() => onPick(opt)}
 className="rounded-full border border-gray-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 transition-all hover:border-blue-400 hover:bg-blue-100 hover:text-blue-800 active:scale-95"
 >
 {opt}
 </button>
 ))}
 </div>
 )}

 {/* 自定义输入 */}
 {!loading && (
 <div className="space-y-2">
 {!showCustom ? (
 <button
 onClick={() => setShowCustom(true)}
 className="text-xs text-gray-500 hover:text-blue-600 transition-colors"
 >
 ✏️ 自定义回答
 </button>
 ) : (
 <div className="flex gap-2">
 <input
 type="text"
 value={custom}
 onChange={(e) => setCustom(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter' && custom.trim()) {
 onPick(custom.trim());
 setCustom('');
 }
 }}
 placeholder="输入你的回答..."
 className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
 autoFocus
 />
 <button
 onClick={() => {
 if (custom.trim()) {
 onPick(custom.trim());
 setCustom('');
 }
 }}
 disabled={!custom.trim()}
 className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-gray-900 hover:bg-blue-700 disabled:opacity-50 transition-colors"
 >
 发送
 </button>
 </div>
 )}
 </div>
 )}

 {/* 跳过 */}
 {!loading && (
 <button
 onClick={onSkip}
 className="mt-3 text-xs text-gray-500/50 hover:text-gray-500 transition-colors"
 >
 跳过这个问题
 </button>
 )}
 </div>
 );
}
