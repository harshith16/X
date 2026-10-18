import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  const showDevLogin =
    process.env.DEV_TEST_LOGIN === "true" && process.env.NODE_ENV !== "production";

  return <LoginForm showDevLogin={showDevLogin} />;
}
