'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  Undo2,
  CheckCircle2,
  Paperclip,
  ArrowRightLeft,
  Box,
  Layers,
  Palette,
} from 'lucide-react';
import { useAppStore, useSpaceGenStore } from '@/lib/store';
import { ChatMessage as ChatMessageType } from '@/lib/types';
import { getEditableSceneSummary, undoSceneAction } from '@/lib/pascal/sceneBridge';
import { executeSpatialToolCalls, ExecutionResult } from '@/lib/ai/executor';
import { replaceItemWithPhotoReference, ReplacementResult } from '@/lib/ai/photoTo3DMatcher';
import { solveSmartPlacements } from '@/lib/ai/spatialLayoutSolver';
import { ChatAttachmentBar } from './ChatAttachmentBar';
import { useViewer } from '@pascal-app/viewer';
import { useScene, AnyNodeId } from '@pascal-app/core';
import { motion, AnimatePresence } from 'framer-motion';

export function ChatPanel() {
  const { chatMessages, addChatMessage, isLoading, setIsLoading } = useAppStore();
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<{
    type: 'image' | 'glb';
    dataUrl: string;
    name: string;
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
      });
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 1-Click "Swap In" photo replacement action
  const handleQuickReplace = async (targetId: string) => {
    if (!attachedFile || attachedFile.type !== 'image' || isLoading) return;

    const targetNode = nodes[targetId as AnyNodeId];
    const photoDataUrl = attachedFile.dataUrl;
    const photoName = attachedFile.name;

    clearAttachment();

    addChatMessage({
      role: 'user',
      content: `Replace "${targetNode?.name || targetId}" with this reference photo (${photoName})`,
      image: photoDataUrl,
      timestamp: Date.now(),
    });

    setIsLoading(true);

    try {
      const result = await replaceItemWithPhotoReference(targetId, photoDataUrl, input);

      if (result.success) {
        addChatMessage({
          role: 'assistant',
          content: `Successfully matched and swapped 3D furniture asset! The underlying Gaussian splat region has been masked out to prevent double-rendering.`,
          timestamp: Date.now(),
          toolResults: [
            {
              toolName: 'replace_item_asset',
              message: `Swapped "${result.previousName}" → "${result.replacementName}"`,
              modifiedNodeIds: [result.nodeId],
            },
            {
              toolName: 'splat_exclusion_mask',
              message: `SuperSplat OBB exclusion volume registered (${result.exclusionBoxId || 'active'})`,
              modifiedNodeIds: [],
            },
          ],
          canUndo: true,
        });
      } else {
        addChatMessage({
          role: 'assistant',
          content: `Unable to replace item: ${result.message}`,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      addChatMessage({
        role: 'assistant',
        content: `Error during 3D asset replacement: ${err?.message || 'Unknown error'}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachedFile) || isLoading) return;

    const userMsg = input.trim();
    const currentAttachment = attachedFile;

    setInput('');
    clearAttachment();

    // If an image is attached and user asks to replace (or an item is selected)
    const isReplaceIntent =
      /\b(replace|swap|change to this|use this)\b/i.test(userMsg) &&
      currentAttachment?.type === 'image' &&
      selectedIds[0];

    if (isReplaceIntent) {
      addChatMessage({
        role: 'user',
        content: userMsg || `Replace selected object with attached photo`,
        image: currentAttachment?.dataUrl,
        timestamp: Date.now(),
      });

      setIsLoading(true);
      try {
        const result = await replaceItemWithPhotoReference(
          selectedIds[0],
          currentAttachment.dataUrl,
          userMsg
        );

        if (result.success) {
          addChatMessage({
            role: 'assistant',
            content: `Replaced "${result.previousName}" with "${result.replacementName}". The original Gaussian splat region has been masked with a SuperSplat exclusion box.`,
            timestamp: Date.now(),
            toolResults: [
              {
                toolName: 'replace_item_asset',
                message: `Matched 3D asset: "${result.replacementName}"`,
                modifiedNodeIds: [result.nodeId],
              },
            ],
            canUndo: true,
          });
        } else {
          addChatMessage({
            role: 'assistant',
            content: result.message,
            timestamp: Date.now(),
          });
        }
      } catch (err: any) {
        addChatMessage({
          role: 'assistant',
          content: `Failed to replace asset: ${err?.message}`,
          timestamp: Date.now(),
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Smart Creative Placement Intent
    const isSmartPlacementIntent =
      /\b(place|put|arrange|spawn)\b/i.test(userMsg) &&
      /\b(chair|table|sofa|furniture|these|around)\b/i.test(userMsg);

    if (isSmartPlacementIntent) {
      addChatMessage({
        role: 'user',
        content: userMsg || 'Place furniture smartly around the room',
        image: currentAttachment?.dataUrl,
        timestamp: Date.now(),
      });

      setIsLoading(true);
      try {
        const sceneSummary = getEditableSceneSummary();
        const modelUrl = currentAttachment?.dataUrl || '/samples/models/chair.glb';
        const modelName = currentAttachment?.name?.replace(/\.glb$/i, '') || 'Dining Chair';
        const candidates = solveSmartPlacements(
          modelUrl,
          modelName,
          'chair',
          [0.55, 0.85, 0.55],
          userMsg,
          sceneSummary
        );

        useSpaceGenStore.getState().setCandidatePlacements(candidates);

        addChatMessage({
          role: 'assistant',
          content: `I've synthesized ${candidates.length} collision-free smart placement proposals adhering to architectural grouping and circulation rules. Review the HUD preview in the 3D viewport to accept or tweak them.`,
          timestamp: Date.now(),
          toolResults: [
            {
              toolName: 'spawn_items_smartly',
              message: `Proposed ${candidates.length} positions: ${candidates.map((c) => c.name).join(', ')}`,
              modifiedNodeIds: [],
            },
          ],
        });
      } catch (err: any) {
        addChatMessage({
          role: 'assistant',
          content: `Failed to compute placement proposals: ${err?.message}`,
          timestamp: Date.now(),
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Standard Spatial Co-Pilot Flow
    addChatMessage({
      role: 'user',
      content: userMsg || (currentAttachment ? `Attached: ${currentAttachment.name}` : ''),
      image: currentAttachment?.dataUrl,
      timestamp: Date.now(),
    });

    setIsLoading(true);

    try {
      const sceneSummary = getEditableSceneSummary();

      const res = await fetch('/api/ai/spatial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userMsg || 'Analyze this reference attachment and apply changes.',
          sceneSummary,
          selectedIds,
          attachment: currentAttachment
            ? {
                type: currentAttachment.type,
                dataUrl: currentAttachment.dataUrl,
                name: currentAttachment.name,
              }
            : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`Spatial API error (${res.status})`);
      }

      const data = await res.json();
      let executionResults: ExecutionResult[] = [];

      if (data.toolCalls && Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
        executionResults = executeSpatialToolCalls(data.toolCalls);
      }

      addChatMessage({
        role: 'assistant',
        content: data.text,
        timestamp: Date.now(),
        toolResults: executionResults.map((r) => ({
          toolName: r.toolName,
          message: r.message,
          modifiedNodeIds: r.modifiedNodeIds,
        })),
        canUndo: executionResults.some((r) => r.success && r.modifiedNodeIds.length > 0),
      });
    } catch (e: any) {
      console.error('[ChatPanel] Error handling spatial request:', e);
      addChatMessage({
        role: 'assistant',
        content:
          'I encountered a communication issue while coordinating with the spatial engine. Please try again.',
        timestamp: Date.now(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = [
    'Move the sofa 0.5m closer to the coffee table',
    'Paint the north wall warm sage',
    'Replace this chair with Scandinavian style',
    'Place dining chairs around the table',
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
              Ask me to move, rearrange, or replace furniture, edit architectural walls, or upload reference photos to swap 3D assets in place.
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
                  Synthesizing spatial scene actions...
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

export default ChatPanel;
