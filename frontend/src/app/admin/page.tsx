import { AuthGuard } from "@/components/AuthGuard";
import { UserManagement } from "@/components/UserManagement";

export default function AdminPage() {
  return (
    <AuthGuard>
      <UserManagement />
    </AuthGuard>
  );
}
