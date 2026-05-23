/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ClueItem } from "../types";
import {
  BookOpen,
  Search,
  Eye,
  HelpCircle,
  FileText,
  Image as ImageIcon,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Download,
  X,
  Loader2,
  BookmarkPlus,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CluesNotebookProps {
  clues: ClueItem[];
  onClose?: () => void;
  onMarkClueRead?: (id: string) => void;
  /**
   * 由 App 注入的按需画图回调。返回 true 表示画图成功(此时上层会把 imageUrl 写入对应
   * clue,父级 prop 刷新),返回 false 表示失败,组件本地展示错误提示。
   */
  onRequestClueImage?: (clue: ClueItem) => Promise<boolean>;
}

export default function CluesNotebook({
  clues,
  onClose,
  onMarkClueRead,
  onRequestClueImage,
}: CluesNotebookProps) {
  const [selectedClueId, setSelectedClueId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const selectedClue = clues.find((c) => c.id === selectedClueId) || null;

  const openClue = (id: string) => {
    setSelectedClueId(id);
    setGenError(null);
    const target = clues.find((c) => c.id === id);
    if (target && !target.read) {
      onMarkClueRead?.(id);
    }
  };

  // 放大镜按钮(或空白容器)的统一点击入口:
  //   - 已有 imageUrl  → 打开全屏预览
  //   - 无 imageUrl    → 调用上层画图,期间在容器内显示转圈动画
  //   - 无 prompt      → 该线索不允许配图,本函数不应被调用,这里兜底直接返回
  const handleZoomOrGenerate = async () => {
    if (!selectedClue) return;
    if (selectedClue.imageUrl) {
      setPreviewImage({ url: selectedClue.imageUrl, title: selectedClue.title });
      return;
    }
    if (!selectedClue.prompt) return;
    if (!onRequestClueImage) return;
    if (generatingId === selectedClue.id) return;

    setGeneratingId(selectedClue.id);
    setGenError(null);
    try {
      const ok = await onRequestClueImage(selectedClue);
      if (!ok) setGenError("画图失败,请检查画图模型配置后重试。");
    } catch (e: any) {
      setGenError(`画图异常:${e?.message || "未知错误"}`);
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div
      id="clues-notebook-root"
      className="w-full h-full bg-[#131516]/95 border border-[#c1a067]/35 rounded-lg flex flex-col font-sans text-gray-200 overflow-hidden"
    >
      {/* Title Header */}
      <div className="p-4 bg-gradient-to-b from-[#181a1c] to-[#111213] border-b border-[#c1a067]/15 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[#c1a067]" />
          <h2 className="text-md font-bold text-gray-100 font-sans">
            调查笔记本
          </h2>
        </div>
      </div>

      {clues.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 font-sans">
          <BookOpen className="w-12 h-12 text-gray-750 stroke-1 mb-3 animate-pulse" />
          <p className="text-sm font-sans">暂无查获的线索道具...</p>
          <p className="text-[10px] text-gray-650 max-w-[240px] mt-1.5 leading-relaxed font-sans">
            "
            当你在故事中发现任何笔记、信札、记号或异常照片时，守密人会将其登记在这本档案中。"
          </p>
        </div>
      ) : !selectedClue ? (
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#141516]">
          <div className="grid grid-cols-1 gap-3">
            {clues.map((clue) => (
              <button
                key={clue.id}
                onClick={() => openClue(clue.id)}
                className="w-full p-4 flex items-center justify-between font-sans border border-gray-800 bg-black/40 rounded transition hover:bg-white/5 hover:border-[#c1a067]/40 text-left"
              >
                <div>
                  <div className="text-[10px] uppercase font-mono tracking-widest text-[#c1a067] mb-1">
                    TYPE: {clue.type}
                  </div>
                  <div className="text-sm font-bold text-gray-200 flex items-center gap-2">
                    {!clue.read && (
                      <span
                        className="inline-block w-2 h-2 rounded-full bg-[#10b981] animate-pulse shrink-0"
                        title="未阅读"
                        aria-label="未阅读"
                      />
                    )}
                    <span>{clue.title}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono mt-1">
                    {clue.discoveredAt}
                  </div>
                </div>
                <div className="text-gray-500">
                  <ChevronLeft className="w-5 h-5 transform rotate-180" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar flex flex-col justify-between leading-relaxed bg-[#141516] relative">
          <div className="space-y-4">
            <button
              onClick={() => setSelectedClueId(null)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#c1a067] transition w-fit border border-gray-800 bg-black/50 px-3 py-1.5 rounded"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> 返回图鉴
            </button>

            {/* Visual Image Render — 仅当线索带 prompt 时展示插图入口,
                纯文字 note/book 直接跳过整块图框,让标题+描述占满详情视图 */}
            {selectedClue.prompt && (
              <>
                <div
                  className={`relative group rounded-lg overflow-hidden border border-[#c1a067]/15 bg-black w-full aspect-[4/3] flex items-center justify-center transition-colors ${
                    selectedClue.imageUrl || generatingId === selectedClue.id
                      ? ""
                      : "cursor-pointer hover:border-[#c1a067]/50"
                  } ${selectedClue.imageUrl ? "cursor-pointer hover:border-[#c1a067]/50" : ""}`}
                  onClick={() => {
                    if (generatingId === selectedClue.id) return;
                    handleZoomOrGenerate();
                  }}
                >
                  {selectedClue.imageUrl ? (
                    <img
                      id="clue-detail-photo"
                      src={selectedClue.imageUrl}
                      alt={selectedClue.title}
                      referrerPolicy="no-referrer"
                      className="object-cover w-full h-full max-h-[220px]"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 text-gray-600 pointer-events-none select-none">
                      <ImageIcon className="w-12 h-12 stroke-1" />
                      <span className="text-[10px] uppercase font-mono tracking-widest">
                        {generatingId === selectedClue.id
                          ? "Rendering..."
                          : "点击放大镜生成插图"}
                      </span>
                    </div>
                  )}

                  {/* Generating overlay */}
                  {generatingId === selectedClue.id && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 z-20 pointer-events-none">
                      <Loader2 className="w-8 h-8 text-[#10b981] animate-spin" />
                      <span className="text-xs text-gray-300 font-mono">
                        正在生成插图...
                      </span>
                    </div>
                  )}

                  {/* Hover preview overlay - only meaningful when image already loaded */}
                  {selectedClue.imageUrl && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <ZoomIn className="w-8 h-8 text-white shadow-xl" />
                    </div>
                  )}

                  <button
                    className="absolute bottom-2 right-2 bg-black/80 hover:bg-[#c1a067] text-white p-2 rounded-full border border-gray-700 transition z-10 disabled:opacity-40 disabled:hover:bg-black/80 disabled:cursor-wait"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleZoomOrGenerate();
                    }}
                    disabled={generatingId === selectedClue.id}
                    title={
                      selectedClue.imageUrl
                        ? "全屏预览"
                        : generatingId === selectedClue.id
                          ? "正在生成..."
                          : "生成线索插图"
                    }
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>

                  {/* Aspect label overlay */}
                  <span className="absolute bottom-2 left-2 text-[8px] bg-black/80 px-2 py-0.5 rounded font-mono border border-gray-800 text-gray-400">
                    SECURED DATA - TYPE: {selectedClue.type.toUpperCase()}
                  </span>
                </div>

                {genError && !selectedClue.imageUrl && (
                  <div className="text-[11px] text-red-400 font-mono bg-red-950/30 border border-red-900/40 px-3 py-1.5 rounded">
                    {genError}
                  </div>
                )}
              </>
            )}

            <div>
              <h3
                id="clue-detail-title"
                className="text-lg font-bold text-[#c1a067] border-b border-[#c1a067]/20 pb-2 flex items-center justify-between"
              >
                <span>{selectedClue.title}</span>
              </h3>
              <div className="text-xs text-gray-400 font-mono mt-1">
                发现刻印: {selectedClue.discoveredAt}
              </div>
            </div>

            <div
              id="clue-detail-description"
              className="bg-black/30 border border-gray-900 p-4 rounded text-xs leading-relaxed text-gray-300 italic font-mono custom-scrollbar max-h-[300px] overflow-y-auto"
            >
              " {selectedClue.description} "
            </div>
          </div>

          {/* Clue manual help footer */}
          <div className="text-[10px] text-gray-650 text-center border-t border-gray-950 pt-3 flex items-center justify-center gap-1.5 font-sans mt-4 shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-650" />
            <span>所有线索皆由守密人(Keeper)探索并转递</span>
          </div>
        </div>
      )}

      {/* Fullscreen Image Preview */}
      {previewImage &&
        createPortal(
          <ImageViewer
            imageUrl={previewImage.url}
            title={previewImage.title}
            onClose={() => setPreviewImage(null)}
          />,
          document.body,
        )}
    </div>
  );
}

export function ImageViewer({
  imageUrl,
  onClose,
  title,
  onSaveAsClue,
  alreadySavedAsClue,
}: {
  imageUrl: string;
  onClose: () => void;
  title: string;
  /**
   * 可选 — 仅当 viewer 用于浏览"对话内即兴 sceneImage"(尚未登记成线索)时由外层注入。
   * 点击触发将 sceneImage 升格为正式的 ClueItem,并在按钮上把状态切到"已收录"。
   * 调查笔记本里的常规线索预览不传此回调,该行按钮不渲染。
   */
  onSaveAsClue?: () => void;
  alreadySavedAsClue?: boolean;
}) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialDistance, setInitialDistance] = useState<number | null>(null);
  const [initialScale, setInitialScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const getDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      setInitialDistance(getDistance(e.touches));
      setInitialScale(scale);
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialDistance) {
      const currentDistance = getDistance(e.touches);
      const newScale = Math.min(
        Math.max(0.5, initialScale * (currentDistance / initialDistance)),
        5,
      );
      setScale(newScale);
    } else if (e.touches.length === 1 && isDragging) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setInitialDistance(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const zoomIn = () => setScale((s) => Math.min(s + 0.5, 5));
  const zoomOut = () => setScale((s) => Math.max(s - 0.5, 0.5));

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clue_${title}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      window.open(imageUrl);
    }
  };

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    // Prevent default wheel behavior on the container
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(Math.max(0.5, s - e.deltaY * 0.005), 5));
    };

    div.addEventListener("wheel", handleWheel, { passive: false });
    return () => div.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      className="fixed inset-[0px] z-[9999] bg-black/95 flex flex-col font-sans backdrop-blur-md m-0 p-0 overflow-hidden animate-in fade-in duration-200"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div className="absolute top-0 left-0 w-full p-4 bg-gradient-to-b from-black/80 to-transparent z-10 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold max-w-[60%] truncate">{title}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={zoomOut}
              className="p-2 bg-gray-900 rounded-full text-white hover:bg-gray-800 transition"
              title="缩小"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-white text-xs font-mono w-10 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="p-2 bg-gray-900 rounded-full text-white hover:bg-gray-800 transition"
              title="放大"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-gray-700 mx-1 border-none" />
            <button
              onClick={handleDownload}
              className="p-2 bg-gray-900 rounded-full text-white hover:bg-[#c1a067] transition"
              title="下载图片"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 bg-red-900/50 rounded-full text-white hover:bg-red-600 transition ml-2"
              title="关闭预览"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {onSaveAsClue && (
          <div className="flex items-center justify-end">
            <button
              onClick={alreadySavedAsClue ? undefined : onSaveAsClue}
              disabled={alreadySavedAsClue}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition ${
                alreadySavedAsClue
                  ? "bg-[#10b981]/15 border-[#10b981]/40 text-[#10b981] cursor-default"
                  : "bg-black/70 border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981] hover:text-black"
              }`}
              title={alreadySavedAsClue ? "已加入调查笔记本" : "把当前图片登记到调查笔记本"}
            >
              {alreadySavedAsClue ? (
                <>
                  <Check className="w-4 h-4" />
                  已收录
                </>
              ) : (
                <>
                  <BookmarkPlus className="w-4 h-4" />
                  收录线索
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center relative touch-none w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <img
          src={imageUrl}
          alt={title}
          draggable={false}
          referrerPolicy="no-referrer"
          className="max-w-none origin-center cursor-move transition-transform ease-out duration-75"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}
