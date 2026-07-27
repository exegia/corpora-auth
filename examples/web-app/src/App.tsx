import "./index.css";

import { SignInForm } from "@exegia/auth-ui"

export function App() {
  return (
    <div className="container mx-auto p-8 text-center relative z-10">
      <SignInForm />
    </div>
  );
}

export default App;
