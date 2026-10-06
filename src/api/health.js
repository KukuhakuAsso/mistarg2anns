import request from "@/api/request";
export async function probeHealth() {
  return request("/api-mist/healthz", {
    method: "GET",
  });
}

export default probeHealth;
