import GroundworkDashboard from "./groundwork-dashboard";
import { requireChatGPTUser } from "./chatgpt-auth";

export default async function GroundworkPage() {
  await requireChatGPTUser("/");
  return <GroundworkDashboard />;
}
