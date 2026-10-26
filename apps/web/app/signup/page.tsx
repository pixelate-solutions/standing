import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create an account" };

export default function Signup() {
  return <AuthForm mode="signup" />;
}
