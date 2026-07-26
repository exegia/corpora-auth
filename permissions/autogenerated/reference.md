## Default Permission

Safe default set for the Supabase auth plugin: the session
lifecycle a typical app needs (sign-up, sign-in via password/OTP/OAuth,
sign-out, session/user queries, manual refresh).

Account-mutation commands are excluded and must be opted into explicitly:
`supabase-auth:allow-reset-password-for-email` and
`supabase-auth:allow-update-user`.

#### This default permission set includes the following:

- `allow-sign-up`
- `allow-sign-in-with-password`
- `allow-sign-in-with-otp`
- `allow-verify-otp`
- `allow-start-oauth-flow`
- `allow-cancel-oauth-flow`
- `allow-sign-out`
- `allow-get-session`
- `allow-get-user`
- `allow-refresh-session`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`supabase-auth:allow-cancel-oauth-flow`

</td>
<td>

Enables the cancel_oauth_flow command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-cancel-oauth-flow`

</td>
<td>

Denies the cancel_oauth_flow command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-delete-passkey`

</td>
<td>

Enables the delete_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-delete-passkey`

</td>
<td>

Denies the delete_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-get-identities`

</td>
<td>

Enables the get_identities command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-get-identities`

</td>
<td>

Denies the get_identities command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-get-passkey-capability`

</td>
<td>

Enables the get_passkey_capability command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-get-passkey-capability`

</td>
<td>

Denies the get_passkey_capability command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-get-session`

</td>
<td>

Enables the get_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-get-session`

</td>
<td>

Denies the get_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-get-user`

</td>
<td>

Enables the get_user command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-get-user`

</td>
<td>

Denies the get_user command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-link-identity`

</td>
<td>

Enables the link_identity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-link-identity`

</td>
<td>

Denies the link_identity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-list-passkeys`

</td>
<td>

Enables the list_passkeys command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-list-passkeys`

</td>
<td>

Denies the list_passkeys command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-passkey-authentication-options`

</td>
<td>

Enables the passkey_authentication_options command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-passkey-authentication-options`

</td>
<td>

Denies the passkey_authentication_options command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-passkey-authentication-verify`

</td>
<td>

Enables the passkey_authentication_verify command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-passkey-authentication-verify`

</td>
<td>

Denies the passkey_authentication_verify command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-passkey-registration-options`

</td>
<td>

Enables the passkey_registration_options command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-passkey-registration-options`

</td>
<td>

Denies the passkey_registration_options command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-passkey-registration-verify`

</td>
<td>

Enables the passkey_registration_verify command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-passkey-registration-verify`

</td>
<td>

Denies the passkey_registration_verify command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-refresh-session`

</td>
<td>

Enables the refresh_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-refresh-session`

</td>
<td>

Denies the refresh_session command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-register-passkey`

</td>
<td>

Enables the register_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-register-passkey`

</td>
<td>

Denies the register_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-rename-passkey`

</td>
<td>

Enables the rename_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-rename-passkey`

</td>
<td>

Denies the rename_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-reset-password-for-email`

</td>
<td>

Enables the reset_password_for_email command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-reset-password-for-email`

</td>
<td>

Denies the reset_password_for_email command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-sign-in-with-otp`

</td>
<td>

Enables the sign_in_with_otp command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-sign-in-with-otp`

</td>
<td>

Denies the sign_in_with_otp command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-sign-in-with-passkey`

</td>
<td>

Enables the sign_in_with_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-sign-in-with-passkey`

</td>
<td>

Denies the sign_in_with_passkey command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-sign-in-with-password`

</td>
<td>

Enables the sign_in_with_password command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-sign-in-with-password`

</td>
<td>

Denies the sign_in_with_password command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-sign-out`

</td>
<td>

Enables the sign_out command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-sign-out`

</td>
<td>

Denies the sign_out command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-sign-up`

</td>
<td>

Enables the sign_up command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-sign-up`

</td>
<td>

Denies the sign_up command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-start-oauth-flow`

</td>
<td>

Enables the start_oauth_flow command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-start-oauth-flow`

</td>
<td>

Denies the start_oauth_flow command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-unlink-identity`

</td>
<td>

Enables the unlink_identity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-unlink-identity`

</td>
<td>

Denies the unlink_identity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-update-user`

</td>
<td>

Enables the update_user command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-update-user`

</td>
<td>

Denies the update_user command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:allow-verify-otp`

</td>
<td>

Enables the verify_otp command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`supabase-auth:deny-verify-otp`

</td>
<td>

Denies the verify_otp command without any pre-configured scope.

</td>
</tr>
</table>
