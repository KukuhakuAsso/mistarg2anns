// 站内信图片附件的客户端状态（api-8-message-mail.md §8.3）。
//
// 时序（已与后端确认）：选图 / 粘贴 / 拖拽 → 立刻 sign + 直传；
// 提交业务接口时只带 objectKey（未传完就禁止提交，失败可单张重试）。
// 只上传没提交的临时对象由服务端按 TTL 清理，所以「移除」只是从列表里去掉，不调接口。
//
// 校验全部在本地完成（前端不压缩）：≤maxCount 张、jpg/png/webp、≤5MiB、长边 ≤1600px。
import { computed, ref } from "vue";
import {
  IMAGE_MAX_COUNT,
  inspectImageFile,
  pickImageFiles,
} from "@/utils/imageUpload";
import { signMedia, uploadToSignedUrl } from "@/api/media";

let uidSeed = 0;

function nextUid() {
  uidSeed += 1;
  return `att-${uidSeed}`;
}

export function useAttachments({ maxCount = IMAGE_MAX_COUNT, onError } = {}) {
  // 每项：{ uid, file, filename, mime, sizeBytes, width, height, previewUrl,
  //        objectKey, status: uploading|done|error, progress, error }
  const items = ref([]);
  const dragging = ref(false);
  const issue = ref("");
  let dragDepth = 0;

  function setIssue(text) {
    issue.value = text || "";
    if (issue.value) onError?.(issue.value);
  }

  const count = computed(() => items.value.length);
  const hasItems = computed(() => items.value.length > 0);
  const canAdd = computed(() => items.value.length < maxCount);
  const uploading = computed(() =>
    items.value.some((item) => item.status === "uploading"),
  );
  const failed = computed(() =>
    items.value.some((item) => item.status === "error"),
  );
  // 有图且全部传完才能提交（提交时只带 objectKey）
  const ready = computed(
    () =>
      items.value.length > 0 &&
      items.value.every((item) => item.status === "done" && item.objectKey),
  );

  function releasePreview(item) {
    if (item?.previewUrl && typeof URL !== "undefined") {
      URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = "";
    }
  }

  async function upload(item) {
    item.status = "uploading";
    item.progress = 0;
    item.error = "";
    item.objectKey = "";

    try {
      const signed = await signMedia({
        filename: item.filename,
        mime: item.mime,
        sizeBytes: item.sizeBytes,
      });
      const uploadInfo = signed?.upload ?? null;
      const objectKey = uploadInfo?.objectKey ?? "";
      if (!objectKey) throw new Error("未获取到上传地址。");

      await uploadToSignedUrl(uploadInfo, item.file, (percent) => {
        item.progress = percent;
      });

      item.objectKey = objectKey;
      item.status = "done";
      item.progress = 100;
      // 上传完成就不再需要本地预览地址（缩略图仍用 previewUrl 展示即可，见 release）
    } catch (error) {
      item.status = "error";
      item.objectKey = "";
      item.error = error?.message || "图片上传失败，请重试。";
    }
  }

  // 统一的入口：选择按钮、Ctrl+V、拖拽都调这里。
  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const slots = maxCount - items.value.length;
    if (slots <= 0) {
      setIssue(`最多只能附带 ${maxCount} 张图片。`);
      return;
    }
    // 超量提示先记下，最后与「文件不合规」的原因一起决定显示哪一条（不能无条件清空）
    let message =
      files.length > slots
        ? `最多只能附带 ${maxCount} 张图片，多余的已忽略。`
        : "";

    const checked = [];
    const failures = [];
    for (const file of files.slice(0, slots)) {
      const result = await inspectImageFile(file);
      if (result.ok) checked.push({ file, result });
      else failures.push(result.reason);
    }

    for (const { file, result } of checked) {
      items.value.push({
        uid: nextUid(),
        file,
        filename: file.name || "image",
        mime: result.mime,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        previewUrl:
          typeof URL !== "undefined" ? URL.createObjectURL(file) : "",
        objectKey: "",
        status: "pending",
        progress: 0,
        error: "",
      });
      // 取数组里的响应式代理再上传（直接改原始对象不会触发视图更新）
      const live = items.value[items.value.length - 1];
      void upload(live);
    }

    if (failures.length) message = failures[0];
    setIssue(message);
  }

  function remove(uid) {
    const index = items.value.findIndex((item) => item.uid === uid);
    if (index < 0) return;
    releasePreview(items.value[index]);
    items.value.splice(index, 1);
    setIssue("");
  }

  function retry(uid) {
    const item = items.value.find((entry) => entry.uid === uid);
    if (!item || item.status === "uploading") return;
    setIssue("");
    void upload(item);
  }

  function clear() {
    for (const item of items.value) releasePreview(item);
    items.value = [];
    setIssue("");
  }

  function dispose() {
    clear();
  }

  // 提交时用：只带传完的图，形状与契约一致（camelCase）
  function serialize() {
    return items.value
      .filter((item) => item.status === "done" && item.objectKey)
      .map((item) => ({
        objectKey: item.objectKey,
        filename: item.filename,
        mime: item.mime,
        sizeBytes: item.sizeBytes,
      }));
  }

  // ---------- 粘贴 / 拖拽 ----------
  // 纯文本粘贴不能被拦截，所以只有剪贴板里真有受支持的图片时才 preventDefault。
  function onPaste(event) {
    const files = pickImageFiles(event.clipboardData?.items, {
      fromClipboard: true,
    });
    if (!files.length) {
      const fallback = pickImageFiles(event.clipboardData?.files, {
        fromClipboard: true,
      });
      if (!fallback.length) return;
      event.preventDefault();
      void addFiles(fallback);
      return;
    }
    event.preventDefault();
    void addFiles(files);
  }

  function hasFilePayload(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes("Files");
  }

  function onDragenter(event) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dragging.value = true;
  }

  function onDragover(event) {
    if (!hasFilePayload(event)) return;
    // 必须阻止默认行为，drop 才会触发（也避免浏览器直接打开图片）
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragging.value = true;
  }

  function onDragleave(event) {
    if (!hasFilePayload(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragging.value = false;
  }

  function onDrop(event) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dragging.value = false;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) void addFiles(files);
  }

  return {
    items,
    dragging,
    issue,
    count,
    hasItems,
    canAdd,
    uploading,
    failed,
    ready,
    maxCount,
    addFiles,
    remove,
    retry,
    clear,
    dispose,
    serialize,
    onPaste,
    onDragenter,
    onDragover,
    onDragleave,
    onDrop,
  };
}
