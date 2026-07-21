"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Brief success screen shown after the final status write succeeds
 * (`showCompleteScreen`, default true). `onComplete` has already fired.
 */
export function CompleteStep(): React.ReactElement {
  return (
    <Alert variant="success">
      <AlertTitle>You're all set</AlertTitle>
      <AlertDescription>
        Your account is ready and your profile has been saved.
      </AlertDescription>
    </Alert>
  );
}
