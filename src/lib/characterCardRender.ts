/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 角色卡 PNG 渲染 + 下载触发。两个出口共用此模块：
 *   1) 创建期 「深渊复核 → 下载调查员角色卡」 — 用 reviewCharacter
 *   2) 运行期 「调查员档案 → 下载调查员角色卡」 — 用 sheet.creationSnapshot
 *
 * 输出格式：512×768 PNG + 末尾 KEEPER_CHARACTER_CARD_UTF8_PAYLOAD: 标记 + JSON.stringify(sheet)。
 * 校验入口（CharacterCreator.handleImportCharacterCard）按同一序列匹配头像位置 (200,94,112,112)。
 */

import type { CharacterSheet } from "../types";

const W = 512;
const H = 768;
const AVATAR_CX = 256;
const AVATAR_CY = 150;
const AVATAR_R = 56;

/** 把 CharacterSheet 渲染为带 JSON payload 尾段的 PNG Blob。 */
export async function renderCharacterCardPng(sheet: CharacterSheet): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create canvas 2D context.");

  // 背景
  ctx.fillStyle = "#121415";
  ctx.fillRect(0, 0, W, H);
  const radGradient = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 520);
  radGradient.addColorStop(0, "#1f2224");
  radGradient.addColorStop(0.5, "#131516");
  radGradient.addColorStop(1, "#070809");
  ctx.fillStyle = radGradient;
  ctx.fillRect(0, 0, W, H);

  // 外框 / 内框
  ctx.strokeStyle = "#c1a067";
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.strokeStyle = "rgba(193, 160, 103, 0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // 四角装饰括号
  const drawBracket = (x: number, y: number, hSign: number, vSign: number) => {
    ctx.strokeStyle = "#c1a067";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + hSign * 28, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + vSign * 28);
    ctx.stroke();
  };
  drawBracket(16, 16, 1, 1);
  drawBracket(W - 16, 16, -1, 1);
  drawBracket(16, H - 16, 1, -1);
  drawBracket(W - 16, H - 16, -1, -1);

  // 顶部档案标签
  ctx.fillStyle = "#c1a067";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("✥ KEEPER INVESTIGATOR SECURE DOSSIER ✥", W / 2, 44);

  // 圆形头像
  await drawAvatarCircle(ctx, sheet);

  // 姓名 / 职业行
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(sheet.name, W / 2, 248);

  ctx.fillStyle = "#c1a067";
  ctx.font = "bold 13px sans-serif";
  const occStr = `${sheet.occupation}  |  ${sheet.gender || "男"} • ${sheet.age || 30}岁  |  ${sheet.background === "modern" ? "Modern" : "1920s"}`;
  ctx.fillText(occStr, W / 2, 274);

  // 顶部分隔线
  sepLine(ctx, 294);

  // HP/MP/SAN
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = "#f87171";
  ctx.fillText(`HP: ${sheet.hp}/${sheet.maxHp}`, 120, 320);
  ctx.fillStyle = "#60a5fa";
  ctx.fillText(`MP: ${sheet.mp}/${sheet.maxMp}`, W / 2, 320);
  ctx.fillStyle = "#34d399";
  ctx.fillText(`SAN: ${sheet.san}/${sheet.maxSan}`, W - 120, 320);

  // 八维属性两行
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11.5px monospace";
  ctx.fillText(
    `STR:${sheet.attributes.str}  CON:${sheet.attributes.con}  SIZ:${sheet.attributes.siz}  DEX:${sheet.attributes.dex}  APP:${sheet.attributes.app}`,
    W / 2,
    356,
  );
  ctx.fillText(
    `INT:${sheet.attributes.int}  POW:${sheet.attributes.pow}  EDU:${sheet.attributes.edu}  LUCK:${sheet.attributes.luck}`,
    W / 2,
    378,
  );

  // 基本信息块
  sepLine(ctx, 402);
  ctx.font = "10.5px sans-serif";
  ctx.textAlign = "left";
  const dash = "—";
  const infoLeft = 60;
  const infoRight = W / 2 + 8;
  drawKv(ctx, "身份 ID", sheet.identity || dash, infoLeft, 426);
  drawKv(ctx, "国籍", sheet.nationality || dash, infoRight, 426);
  drawKv(ctx, "居住地", sheet.residence || dash, infoLeft, 446);
  drawKv(ctx, "母语", sheet.motherTongue || dash, infoRight, 446);
  drawKv(ctx, "信用评级", typeof sheet.creditRating === "number" ? String(sheet.creditRating) : dash, infoLeft, 466);
  drawKv(ctx, "现金余额", typeof sheet.cashBalance === "number" ? String(sheet.cashBalance) : dash, infoRight, 466);

  // 技能区
  sepLine(ctx, 490);
  ctx.fillStyle = "#c1a067";
  ctx.font = "bold 11.5px monospace";
  ctx.textAlign = "center";
  ctx.fillText("✦  调查员技能档 SKILLS  ✦", W / 2, 510);

  const filteredSkills = Object.entries(sheet.skills)
    .filter(([sk]) => sk !== "克苏鲁神话")
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  const SKILL_TOP = 534;
  const SKILL_LH = 22;
  const SKILL_LEFT = 60;
  const SKILL_RIGHT = W / 2 + 8;
  const MAX_ROWS = 9;
  for (let i = 0; i < filteredSkills.length && i < MAX_ROWS * 2; i++) {
    const [sk, val] = filteredSkills[i];
    const isLeft = i < MAX_ROWS;
    const x = isLeft ? SKILL_LEFT : SKILL_RIGHT;
    const y = SKILL_TOP + (isLeft ? i : i - MAX_ROWS) * SKILL_LH;
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(`${sk}`, x, y);
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 11px monospace";
    ctx.fillText(`${val}%`, x + 168, y);
    ctx.font = "11px sans-serif";
  }
  if (filteredSkills.length === 0) {
    ctx.fillStyle = "#9ca3af";
    ctx.fillText("常规探查学者", SKILL_LEFT, SKILL_TOP);
  }

  // 底部签名
  ctx.fillStyle = "rgba(193, 160, 103, 0.45)";
  ctx.font = "italic 9.5px monospace";
  ctx.textAlign = "center";
  ctx.fillText("CHRONOS SYSTEM SIGNATURE • TYPE-MOON & FOUNDATION DUAL COOPERATION", W / 2, H - 32);

  const basePngBlob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), "image/png");
  });
  const basePngBytes = new Uint8Array(await basePngBlob.arrayBuffer());

  const encoder = new TextEncoder();
  const markerBytes = encoder.encode("KEEPER_CHARACTER_CARD_UTF8_PAYLOAD:");
  const jsonPayloadBytes = encoder.encode(JSON.stringify(sheet));

  const total = new Uint8Array(basePngBytes.length + markerBytes.length + jsonPayloadBytes.length);
  total.set(basePngBytes, 0);
  total.set(markerBytes, basePngBytes.length);
  total.set(jsonPayloadBytes, basePngBytes.length + markerBytes.length);

  return new Blob([total], { type: "image/png" });
}

/** 触发浏览器下载（默认文件名 `${name}_investigator_sheet.png`）。 */
export async function downloadCharacterCard(sheet: CharacterSheet, fileName?: string): Promise<void> {
  const blob = await renderCharacterCardPng(sheet);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `${sheet.name}_investigator_sheet.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 400);
}

// ---- 内部辅助 ----

function sepLine(ctx: CanvasRenderingContext2D, cy: number) {
  ctx.strokeStyle = "rgba(193, 160, 103, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, cy);
  ctx.lineTo(W - 60, cy);
  ctx.stroke();
  ctx.fillStyle = "#c1a067";
  ctx.beginPath();
  ctx.moveTo(W / 2, cy - 4);
  ctx.lineTo(W / 2 + 4, cy);
  ctx.lineTo(W / 2, cy + 4);
  ctx.lineTo(W / 2 - 4, cy);
  ctx.fill();
}

function drawKv(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number) {
  ctx.fillStyle = "#c1a067";
  ctx.fillText(label, x, y);
  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(value, x + 60, y);
}

async function drawAvatarCircle(ctx: CanvasRenderingContext2D, sheet: CharacterSheet) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_R + 2, 0, Math.PI * 2);
  ctx.fillStyle = "#0c0d0e";
  ctx.fill();
  ctx.strokeStyle = "#c1a067";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  const fallback = () => {
    ctx.fillStyle = "#c1a067";
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sheet.name.trim().charAt(0).toUpperCase(), AVATAR_CX, AVATAR_CY);
  };

  if (!sheet.avatar) {
    fallback();
    return;
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = sheet.avatar;
  await new Promise<void>((resolve) => {
    img.onload = () => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_R, 0, Math.PI * 2);
      ctx.clip();
      const dSize = AVATAR_R * 2;
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      const side = Math.min(srcW, srcH);
      const sx = (srcW - side) / 2;
      const sy = (srcH - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, AVATAR_CX - AVATAR_R, AVATAR_CY - AVATAR_R, dSize, dSize);
      ctx.restore();
      resolve();
    };
    img.onerror = () => {
      fallback();
      resolve();
    };
  });
}
