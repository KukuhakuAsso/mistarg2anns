// 线索拖拽（指针事件实现，兼容鼠标 / 触屏 / 触控笔）。
//
// 三种交互：
//   1. 待用线索 -> 板面：落在板面上则新建卡片
//   2. 板面卡片 -> 板面：移动位置
//   3. 板面卡片 -> 板面外：退回待用区
//
// 页面只有一个线索板，因此拖拽状态用模块级单例。

import { reactive, ref } from "vue";
import { CARD_H, CARD_W } from "@/config/board";
import { useGameState } from "./useGameState";

// 板面画布元素（由 ClueBoard 注册），用于落点判定与坐标换算
const boardEl = ref(null);

const drag = reactive({
    active: false,
    clueId: null,
    source: null, // "pool"（待用区） | "board"（板面）
    x: 0, // 指针位置（client 坐标）
    y: 0,
    offsetX: 0, // 抓取点相对卡片左上角的偏移
    offsetY: 0,
    w: CARD_W,
    h: CARD_H,
    overBoard: false,
});

function boardRect() {
    return boardEl.value ? boardEl.value.getBoundingClientRect() : null;
}

function isOverBoard(x, y) {
    const rect = boardRect();
    if (!rect) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

export function useClueDrag() {
    const { placeClue, removeClueFromBoard, discoverClue } = useGameState();

    function stop() {
        drag.active = false;
        drag.clueId = null;
        drag.source = null;
        drag.overBoard = false;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", stop);
        document.body.classList.remove("is-dragging");
    }

    function handleMove(event) {
        drag.x = event.clientX;
        drag.y = event.clientY;
        drag.overBoard = isOverBoard(drag.x, drag.y);
    }

    function handleUp() {
        const rect = boardRect();

        if (drag.clueId && rect && drag.overBoard) {
            const x = clamp(drag.x - rect.left - drag.offsetX, 0, rect.width - drag.w);
            const y = clamp(drag.y - rect.top - drag.offsetY, 0, rect.height - drag.h);
            if (drag.source === "puzzle") {
                discoverClue(drag.clueId);
            }
            placeClue(drag.clueId, Math.round(x), Math.round(y));
        } else if (drag.clueId && drag.source === "board") {
            removeClueFromBoard(drag.clueId);
        }

        stop();
    }

    function startDrag(event, clueId, source) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();

        const rect = event.currentTarget.getBoundingClientRect();

        drag.clueId = clueId;
        drag.source = source;
        drag.active = true;
        drag.x = event.clientX;
        drag.y = event.clientY;

        if (source === "board") {
            drag.w = rect.width || CARD_W;
            drag.h = rect.height || CARD_H;
            drag.offsetX = event.clientX - rect.left;
            drag.offsetY = event.clientY - rect.top;
        } else {
            // 待用区条目尺寸与卡片不同，统一按卡片居中跟随指针
            drag.w = CARD_W;
            drag.h = CARD_H;
            drag.offsetX = CARD_W / 2;
            drag.offsetY = CARD_H / 2;
        }

        drag.overBoard = isOverBoard(drag.x, drag.y);

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", stop);
        document.body.classList.add("is-dragging");
    }

    return { boardEl, drag, startDrag };
}
