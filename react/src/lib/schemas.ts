import { z } from "zod";

/** Valid, non-empty email address. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

/** Default password policy (min 8 chars). Overridable per block via `passwordPolicy`. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

/** Six-digit one-time code. */
export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

/** Sign-in: email + non-empty password (policy is not enforced at sign-in). */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/** Sign-up: email + password (policy) + matching confirmation. */
export function buildSignUpSchema(
  passwordPolicy: z.ZodType<string> = passwordSchema,
) {
  return z
    .object({
      email: emailSchema,
      password: passwordPolicy,
      confirmPassword: z.string().min(1, "Confirm your password"),
    })
    .superRefine((values, ctx) => {
      if (values.password !== values.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmPassword"],
          message: "Passwords do not match",
        });
      }
    });
}

export const signUpSchema = buildSignUpSchema();

/** Update-password: new password (policy) + matching confirmation. */
export function buildUpdatePasswordSchema(
  passwordPolicy: z.ZodType<string> = passwordSchema,
) {
  return z
    .object({
      password: passwordPolicy,
      confirmPassword: z.string().min(1, "Confirm your password"),
    })
    .superRefine((values, ctx) => {
      if (values.password !== values.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmPassword"],
          message: "Passwords do not match",
        });
      }
    });
}

export const updatePasswordSchema = buildUpdatePasswordSchema();

/** Forgot-password / OTP request: just an email. */
export const emailRequestSchema = z.object({ email: emailSchema });

/** OTP verification: the 6-digit token. */
export const otpVerifySchema = z.object({ token: otpSchema });

/**
 * Runs a zod object schema and flattens field errors into a
 * `{ field: firstMessage }` record, or returns the parsed data.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
):
  | { ok: true; data: z.infer<T> }
  | { ok: false; fieldErrors: Record<string, string> } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors };
}
