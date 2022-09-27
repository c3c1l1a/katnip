import {katnip, PromiseButton, BsAlert, useForm, delay, apiFetch, useCounter,
		useCurrentUser, setCurrentUser} from "katnip";
import {useState} from "preact/compat";

export default function DeleteAccountTab() {
	let form=useForm({initial: {}});
	let [message, setMessage]=useState();
	let user=useCurrentUser();

	async function onDeleteAccountClick() {
		setMessage();
		await apiFetch("/api/deleteAccount",form.getCurrent());

		setCurrentUser(null);
		katnip.setLocation("/");
	}

	return (
		<form>
			<BsAlert message={message} ondismiss={setMessage}/>
			<div class="mb-3" >
				<label class="form-label">
					If you Are <b>absolutely sure</b> you want to delete your account, enter your password here.
					This cannot be undone!
				</label>
				<input type="password" class="form-control"
					{...form("password")}/>
			</div>
			<PromiseButton class="btn btn-danger mt-3"
					onclick={onDeleteAccountClick}
					onerror={setMessage}>
				Delete Account
			</PromiseButton>
		</form>
	);
}
