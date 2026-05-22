import React from "react";
import { ImageProviderKind, LlmProviderKind } from "../../types";
import { QinyIcon } from "./QinyIcon";
import { CustomProviderIcon } from "./CustomProviderIcon";
import geminiSvg from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import claudeSvg from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import grokSvg from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import deepseekSvg from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";

interface IconProps {
  size?: number;
}

function RawSvg({ svg, size }: { svg: string; size: number }) {
  // The static SVGs ship with intrinsic dimensions; sizing on the wrapper
  // forces them to render at the caller's requested size while preserving
  // the original viewBox.
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function LlmProviderIcon({ kind, size = 18 }: IconProps & { kind: LlmProviderKind }) {
  switch (kind) {
    case "qiny":
      return <QinyIcon size={size} />;
    case "custom":
      return <CustomProviderIcon size={size} />;
    case "gemini":
      return <RawSvg svg={geminiSvg} size={size} />;
    case "anthropic":
      return <RawSvg svg={claudeSvg} size={size} />;
    case "grok":
      return <RawSvg svg={grokSvg} size={size} />;
    case "deepseek":
      return <RawSvg svg={deepseekSvg} size={size} />;
  }
}

export function ImageProviderIcon({ kind, size = 18 }: IconProps & { kind: ImageProviderKind }) {
  switch (kind) {
    case "qiny":
      return <QinyIcon size={size} />;
  }
}

export const LLM_PROVIDER_LABELS: Record<LlmProviderKind, string> = {
  qiny: "QinyAPI",
  custom: "自定义供应商",
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  grok: "Grok",
  deepseek: "DeepSeek",
};

export const IMAGE_PROVIDER_LABELS: Record<ImageProviderKind, string> = {
  qiny: "QinyAPI",
};
