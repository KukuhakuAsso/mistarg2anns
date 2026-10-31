import { computed, ref } from "vue";
import request from "@/api/request";

// 图片附件的**唯一**能力开关（api-8-message-mail.md §8.0）：
// `GET /api/msg/policy` 的 `attachmentsEnabled`，为 false 时不要渲染选图入口
// （此时 sign 与带附件的提交都会 403 MSG_IMAGE_DISABLED）。
//
// 判值口径（与后端确认）：**严格** —— 只有明确为 true 才算开启，字段缺失 / 请求失败一律按关闭处理。
// 站内信与申诉页都读这一份：2026-10-31 起后端对封禁账号也放行本接口，
// 所以不再需要用 /api/me/status 里的同名字段兜底（两个数据源只会互相打架）。
export function useMsgAttachments() {
  const policy = ref(null);
  const loading = ref(false);
  const loaded = ref(false);
  let inflight = null;

  // 不进缓存：策略因用户而异（禁言 / 队伍封禁 / 开关），每次进入页面重新取。
  async function loadPolicy() {
    if (inflight) return inflight;
    loading.value = true;
    inflight = (async () => {
      try {
        const payload = await request("/msg/policy", {
          method: "GET",
          useAuth: true,
        });
        policy.value = payload?.data ?? null;
        return policy.value;
      } catch {
        // 拿不到策略就按「未开启」处理：宁可少显示选图入口，也不让用户点了才吃 403
        policy.value = null;
        return null;
      } finally {
        loaded.value = true;
        loading.value = false;
        inflight = null;
      }
    })();
    return inflight;
  }

  const attachmentsEnabled = computed(
    () => policy.value?.attachmentsEnabled === true,
  );
  const muted = computed(() => Boolean(policy.value?.muted));

  return { policy, loading, loaded, loadPolicy, attachmentsEnabled, muted };
}

export default useMsgAttachments;
