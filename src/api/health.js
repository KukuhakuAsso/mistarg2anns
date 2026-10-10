import request from "@/api/request";

// 检查服务器用 API 接口

export async function probeHealth() {
  return request("/api-mist/healthz", {
    method: "GET",
  });
}

export default probeHealth;
