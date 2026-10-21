'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  Undo2,
  CheckCircle2,
  Paperclip,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { ChatMessage as ChatMessageType } from '@/lib/types';
import type { EditProposal } from '@/lib/contracts';
import { undoSceneAction } from '@/lib/pascal/sceneBridge';
import { acceptProposal } from '@/lib/pascal/applyProposal';
import { getTrustedInterpretation } from '@/lib/pascal/interpretationReview';
import { ChatAttachmentBar } from './ChatAttachmentBar';
import { useViewer } from '@pascal-app/viewer';
import { useScene, AnyNodeId } from '@pascal-app/core';
import { motion, AnimatePresence } from 'framer-motion';

const PROPOSAL_NODE_TYPES = new Set(['item', 'wall', 'door', 'window', 'slab', 'level', 'zone']);

export function ChatPanel() {
  const { chatMessages, addChatMessage, isLoading, setIsLoading } = useAppStore();
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<{
    type: 'image' | 'glb';
    dataUrl: string;
    name: string;
    url?: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const nodes = useScene((state) => state.nodes);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, isLoading]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isGlb = file.name.endsWith('.glb') || file.name.endsWith('.gltf');
    const type = isGlb ? 'glb' : 'image';

    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedFile({
        type,
        dataUrl: event.target?.result as string,
        name: file.name,
        // Proposals reference the uploaded GLB by a URL this browser session can load.
        url: isGlb ? URL.createObjectURL(file) : undefined,
      });
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** Asks the agent for EditProposals; nothing changes until the user accepts one. */
  const requestProposals = async (
    prompt: string,
    attachment: typeof attachedFile,
    selection: string[],
  ) => {
    setIsLoading(true);
    try {
      const sceneNodes = Object.fromEntries(
        Object.entries(useScene.getState().nodes).filter(([, n]) => n && PROPOSAL_NODE_TYPES.has(n.type)),
      );
      const res = await fetch('/api/ai/spatial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          nodes: sceneNodes,
          // Scan rooms: the solver sees only verified or corrected elements.
          interpretation: getTrustedInterpretation().interpretation ?? undefined,
          selectedIds: selection,
          attachment: attachment
            ? { type: attachment.type, dataUrl: attachment.dataUrl, name: attachment.name, url: attachment.url }
            : undefined,
        }),
      });
      if (!res.ok) throw new Error(`Spatial API error (${res.status})`);
      const data: {
        message: string;
        proposals: EditProposal[];
        annotations: Record<string, { label: string; category: string }>;
        notes?: string[];
      } = await res.json();

      addChatMessage({
        role: 'assistant',
        content: [data.message, ...(data.notes ?? [])].filter(Boolean).join('\n'),
        timestamp: Date.now(),
        proposals: data.proposals,
        proposalLabels: data.annotations,
      });
    } catch (e) {
      console.error('[ChatPanel] Error handling spatial request:', e);
      addChatMessage({
        role: 'assistant',
        content: 'I could not reach the spatial planner. Please try again.',
        timestamp: Date.now(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // "Swap In" on the attachment bar: ask for a replacement proposal for that item.
  const handleQuickReplace = async (targetId: string) => {
    if (!attachedFile || isLoading) return;
    const targetNode = nodes[targetId as AnyNodeId];
    const attachment = attachedFile;
    clearAttachment();
    const prompt = `Replace the selected ${targetNode?.name || 'item'} with this ${attachment.type === 'glb' ? 'model' : 'photo'}`;
    addChatMessage({
      role: 'user',
      content: prompt,
      image: attachment.type === 'image' ? attachment.dataUrl : undefined,
      timestamp: Date.now(),
    });
    await requestProposals(prompt, attachment, [targetId]);
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachedFile) || isLoading) return;

    const userMsg = input.trim();
    const currentAttachment = attachedFile;

    setInput('');
    clearAttachment();

    addChatMessage({
      role: 'user',
      content: userMsg || (currentAttachment ? `Attached: ${currentAttachment.name}` : ''),
      image: currentAttachment?.type === 'image' ? currentAttachment.dataUrl : undefined,
      timestamp: Date.now(),
    });

    await requestProposals(
      userMsg || 'Suggest where this attachment fits in the room.',
      currentAttachment,
      selectedIds as string[],
    );
  };

  const quickActions = [
    'Move the sofa 0.5m closer to the coffee table',
    'Move the sofa against the long wall',
    'Replace the selected chair with a Scandinavian one',
    'Add 4 dining chairs around the dining table',
  ];

  return (
    <div className="flex flex-col h-full bg-surface text-text-primary">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-surface/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-brand flex items-center justify-center shadow-md shadow-accent/20">
            <Sparkles size={14} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-sm leading-tight">Spatial AI Co-Pilot</h2>
            <p className="text-[10px] text-text-muted leading-tight font-mono">
              Pascal BIM & Gaussian Splat Studio
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedIds.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/25 font-mono">
              {selectedIds.length} selected
            </span>
          )}
          <span className="badge-accent">Gemini 2.5</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.length <= 1 && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 pt-2"
          >
            <div className="p-3 rounded-xl bg-surface-elevated/40 border border-border/60 text-xs text-text-secondary leading-relaxed">
              <span className="font-semibold text-accent-light block mb-1">
                Spatial Co-Pilot Active
              </span>
              Ask me to add, move, replace or remove furniture, or attach a reference photo or .glb model. I propose edits; nothing changes until you accept.
            </div>

            <p className="text-[11px] text-text-muted text-center font-medium">Quick spatial actions</p>
            <div className="grid grid-cols-1 gap-1.5">
              {quickActions.map((action) => (
                <button
                  key={action}
                  onClick={() => {
                    setInput(action);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-2 text-xs text-left rounded-xl border border-border hover:border-accent/40 hover:bg-accent/5 text-text-secondary hover:text-text-primary transition-all duration-150 flex items-center justify-between group"
                >
                  <span className="truncate">{action}</span>
                  <Sparkles size={11} className="text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="popLayout">
          {chatMessages.map((msg, i) => (
            <motion.div
              key={`msg-${i}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2 }}
            >
              <ChatMessage message={msg} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex gap-3 max-w-[90%]"
            >
              <div className="w-6 h-6 rounded-lg bg-gradient-brand flex items-center justify-center shrink-0">
                <Sparkles size={11} className="text-white" />
              </div>
              <div className="glass-elevated px-4 py-2.5 rounded-2xl rounded-tl-sm border border-border/80 flex items-center gap-2">
                <Loader2 size={13} className="animate-spin text-accent" />
                <span className="text-xs text-text-secondary font-mono">
                  Planning edit proposals...
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment Context & Preview Bar */}
      <ChatAttachmentBar
        attachedFile={attachedFile}
        onClearAttachment={clearAttachment}
        onQuickReplace={handleQuickReplace}
      />

      {/* Input area */}
      <div className="p-4 border-t border-border shrink-0 bg-surface/90">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.glb,.gltf"
          className="hidden"
          onChange={handleFileUpload}
        />

        <div className="relative flex items-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute left-3 text-text-muted hover:text-accent transition-colors"
            title="Attach reference photo (.png, .jpg) or 3D asset (.glb)"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Describe design changes, move objects, or ask AI..."
            className="w-full bg-surface-elevated border border-border rounded-xl py-2.5 pl-10 pr-12 text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all placeholder:text-text-muted text-text-primary"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            disabled={(!input.trim() && !attachedFile) || isLoading}
            className="absolute right-2 p-1.5 bg-accent hover:bg-accent-dark disabled:bg-surface-elevated disabled:text-text-muted text-white rounded-lg transition-colors shadow-sm shadow-accent/20"
          >
            <Send size={13} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user';
  const [undone, setUndone] = useState(false);

  const handleUndo = () => {
    undoSceneAction();
    setUndone(true);
  };

  return (
    <div className={`flex gap-2.5 max-w-[95%] ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-lg bg-gradient-brand flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
          <Sparkles size={10} className="text-white" />
        </div>
      )}
      <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
            isUser
              ? 'bg-accent text-white rounded-tr-sm shadow-sm shadow-accent/20'
              : 'glass-elevated rounded-tl-sm border border-border/80 text-text-primary'
          }`}
        >
          {message.content}
        </div>

        {/* Attached photo or generated preview */}
        {message.image && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl overflow-hidden border border-border max-w-[260px] shadow-card group"
          >
            <img
              src={message.image}
              alt="Visual attachment"
              className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </motion.div>
        )}

        {message.proposals && message.proposals.length > 0 && (
          <ProposalList proposals={message.proposals} labels={message.proposalLabels ?? {}} />
        )}

        {/* Spatial tool execution cards */}
        {message.toolResults && message.toolResults.length > 0 && (
          <div className="flex flex-col gap-1 w-full max-w-[320px] mt-1">
            {message.toolResults.map((tr, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-mono"
              >
                <CheckCircle2 size={12} className="shrink-0" />
                <span className="truncate">{tr.message}</span>
              </div>
            ))}

            {/* 1-Click Interactive Undo AI Changes Chip */}
            {message.canUndo && (
              <div className="pt-1">
                {undone ? (
                  <span className="text-[10px] text-text-muted font-mono italic">
                    AI Changes Reverted
                  </span>
                ) : (
                  <button
                    onClick={handleUndo}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-surface-elevated hover:bg-surface border border-border text-text-secondary hover:text-text-primary transition-all shadow-sm"
                  >
                    <Undo2 size={12} />
                    <span>Undo AI Changes</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalList({
  proposals,
  labels,
}: {
  proposals: EditProposal[];
  labels: Record<string, { label: string; category: string }>;
}) {
  const [status, setStatus] = useState<Record<string, EditProposal['status']>>({});
  const [error, setError] = useState<string | null>(null);

  const accept = (p: EditProposal) => {
    try {
      acceptProposal(p, useScene.getState().nodes as Record<string, unknown>, labels[p.id] ?? { label: 'Item', category: 'item' });
      setStatus((s) => ({ ...s, [p.id]: 'accepted' }));
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not apply proposal');
    }
  };

  return (
    <div className="flex flex-col gap-1.5 w-full max-w-[320px] mt-1">
      {proposals.map((p) => {
        const state = status[p.id] ?? p.status;
        const flagged = p.validation.violations.filter((v) => v.severity !== 'info');
        return (
          <div key={p.id} className="p-2 rounded-lg border border-border bg-surface-elevated/60 text-[11px] flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono uppercase text-accent">{p.op}</span>
              <span className="truncate text-text-primary">{labels[p.id]?.label ?? p.targetNodeId ?? 'Item'}</span>
              {p.validation.ok ? (
                <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={12} className="text-red-400 shrink-0" />
              )}
            </div>
            <p className="text-text-secondary leading-snug">{p.rationale}</p>
            {flagged.map((v, i) => (
              <p key={i} className={`flex items-start gap-1 ${v.severity === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>{v.detail}</span>
              </p>
            ))}
            {state === 'pending' ? (
              <div className="flex gap-1.5 pt-0.5">
                <button
                  onClick={() => accept(p)}
                  disabled={!p.validation.ok}
                  className="px-2 py-0.5 rounded-md bg-accent text-white disabled:opacity-40"
                >
                  Accept
                </button>
                <button
                  onClick={() => setStatus((s) => ({ ...s, [p.id]: 'rejected' }))}
                  className="px-2 py-0.5 rounded-md border border-border text-text-secondary"
                >
                  Reject
                </button>
              </div>
            ) : (
              <span className="text-text-muted font-mono">{state}</span>
            )}
          </div>
        );
      })}
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
      {Object.values(status).includes('accepted') && (
        <button
          onClick={() => undoSceneAction()}
          className="self-start flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-surface-elevated border border-border text-text-secondary"
        >
          <Undo2 size={12} />
          <span>Undo last accepted edit</span>
        </button>
      )}
    </div>
  );
}

export default ChatPanel;
