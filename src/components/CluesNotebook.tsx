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
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CluesNotebookProps {
  clues: ClueItem[];
  onClose?: () => void;
}

export default function CluesNotebook({ clues, onClose }: CluesNotebookProps) {
  const [selectedClueId, setSelectedClueId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
  } | null>(null);

  const selectedClue = clues.find((c) => c.id === selectedClueId) || null;

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
            调查笔记本 (Clue Logbook)
          </h2>
        </div>
        <div className="text-xs text-[#c1a067] font-mono">
          已收集: {clues.length} 个线索
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
                onClick={() => setSelectedClueId(clue.id)}
                className="w-full p-4 flex items-center justify-between font-sans border border-gray-800 bg-black/40 rounded transition hover:bg-white/5 hover:border-[#c1a067]/40 text-left"
              >
                <div>
                  <div className="text-[10px] uppercase font-mono tracking-widest text-[#c1a067] mb-1">
                    TYPE: {clue.type}
                  </div>
                  <div className="text-sm font-bold text-gray-200">
                    {clue.title}
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

            {/* Visual Image Render */}
            <div
              className={`relative group rounded-lg overflow-hidden border border-[#c1a067]/15 bg-black w-full aspect-[4/3] flex items-center justify-center cursor-pointer hover:border-[#c1a067]/50 transition-colors`}
              onClick={() => {
                const canvasNode = document.getElementById(
                  "clue-procedural-canvas",
                ) as HTMLCanvasElement;
                const previewUrl =
                  selectedClue.imageUrl || canvasNode?.toDataURL() || "";
                if (previewUrl) {
                  setPreviewImage({
                    url: previewUrl,
                    title: selectedClue.title,
                  });
                }
              }}
            >
              {selectedClue.imageUrl ? (
                <>
                  <img
                    id="clue-detail-photo"
                    src={selectedClue.imageUrl}
                    alt={selectedClue.title}
                    referrerPolicy="no-referrer"
                    className="object-cover w-full h-full max-h-[220px]"
                  />
                </>
              ) : (
                <ProceduralCluePaper
                  title={selectedClue.title}
                  type={selectedClue.type}
                  description={selectedClue.description}
                />
              )}

              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <ZoomIn className="w-8 h-8 text-white shadow-xl" />
              </div>
              <button
                className="absolute bottom-2 right-2 bg-black/80 hover:bg-[#c1a067] text-white p-2 rounded-full border border-gray-700 transition z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  const canvasNode = document.getElementById(
                    "clue-procedural-canvas",
                  ) as HTMLCanvasElement;
                  const previewUrl =
                    selectedClue.imageUrl || canvasNode?.toDataURL() || "";
                  if (previewUrl) {
                    setPreviewImage({
                      url: previewUrl,
                      title: selectedClue.title,
                    });
                  }
                }}
                title="全屏预览"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              {/* Aspect label overlay */}
              <span className="absolute bottom-2 left-2 text-[8px] bg-black/80 px-2 py-0.5 rounded font-mono border border-gray-800 text-gray-400">
                SECURED DATA - TYPE: {selectedClue.type.toUpperCase()}
              </span>
            </div>

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

// Procedural visual clue canvas drawer component
function ProceduralCluePaper({
  title,
  type,
  description,
}: {
  title: string;
  type: string;
  description: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset dimensions
    canvas.width = 400;
    canvas.height = 300;

    // 1. Draw Paper Background (parchment texture)
    const grade = ctx.createRadialGradient(200, 150, 40, 200, 150, 220);
    grade.addColorStop(0, "#f9f2e3"); // warm cream
    grade.addColorStop(0.7, "#eddcb4"); // aged golden tea
    grade.addColorStop(1, "#c5aa70"); // dark burnt edges

    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, 400, 300);

    // 2. Distressed paper details
    ctx.strokeStyle = "rgba(100,60,30,0.15)";
    ctx.lineWidth = 1;

    // Draw lines to simulate vintage ledger or notebook
    if (type === "note" || type === "book") {
      for (let y = 60; y < 280; y += 22) {
        ctx.beginPath();
        ctx.moveTo(30, y);
        ctx.lineTo(370, y);
        ctx.stroke();
      }
    } else if (type === "marking") {
      // Draw standard occult summoning star pattern or magic circuits
      ctx.strokeStyle = "rgba(180, 20, 10, 0.4)"; // dried blood red
      ctx.lineWidth = 2.5;

      // Pentagram
      ctx.beginPath();
      ctx.arc(200, 150, 70, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      // Draw a 5-star geometry
      const points = [];
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI * 4) / 5;
        points.push({
          x: 200 + Math.cos(angle) * 70,
          y: 150 + Math.sin(angle) * 70,
        });
      }
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i <= 5; i++) {
        const pt = points[i % 5];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();

      // Sigils circles
      ctx.beginPath();
      ctx.arc(200, 150, 62, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === "photo") {
      // Photo polaroid border overlay
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.fillRect(40, 30, 320, 200);

      // Distorted glowing orb or blurry shadow inside Polaroid
      const radGrad = ctx.createRadialGradient(180, 110, 5, 180, 110, 80);
      radGrad.addColorStop(0, "rgba(220,180,255,0.7)");
      radGrad.addColorStop(0.5, "rgba(100,50,250,0.3)");
      radGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = radGrad;
      ctx.fillRect(40, 30, 320, 200);

      // Polaroid photo border
      ctx.lineWidth = 14;
      ctx.strokeStyle = "#e8e5dc";
      ctx.strokeRect(33, 23, 334, 254);
    }

    // 3. Render Handdrawn texts (Title and contents)
    ctx.fillStyle = "#1e130a"; // dark carbon ink

    if (type !== "photo" && type !== "marking") {
      ctx.font = "bold 14px Georgia, serif";
      ctx.fillText(title, 40, 45);

      ctx.font = "italic 10px Courier New, monospace";
      ctx.fillStyle = "#4a3520";

      // Word wrap for description in procedural paper
      const words = description.split("");
      let line = "";
      let y = 80;
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n];
        if (testLine.length > 28 && n > 0) {
          ctx.fillText(line, 40, y);
          line = words[n];
          y += 22;
        } else {
          line = testLine;
        }
        if (y > 270) break;
      }
      ctx.fillText(line, 40, y);
    } else {
      // overlay title under polaroid
      ctx.fillStyle = "#3a2412";
      ctx.font = "bold 11px Georgia, serif";
      ctx.fillText(`线索: ${title}`, 45, 256);
    }
  }, [title, type, description]);

  return (
    <canvas
      id="clue-procedural-canvas"
      ref={canvasRef}
      className="max-h-[220px] max-w-full rounded shadow-xl"
    />
  );
}

function ImageViewer({
  imageUrl,
  onClose,
  title,
}: {
  imageUrl: string;
  onClose: () => void;
  title: string;
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
      <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 w-full z-10 shrink-0">
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
