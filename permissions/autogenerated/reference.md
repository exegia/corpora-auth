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
