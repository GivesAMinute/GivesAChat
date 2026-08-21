# SSH key rotation

Two SSH keypairs were committed to this public repository and must be
treated as compromised:

| Key | Committed | Fingerprint |
|---|---|---|
| `ssh-key-2026-07-25` | `8da8f20`, 26 Jul 2026 | — |
| `ssh-key-2026-07-27` | `8b88c42`, 27 Jul 2026 | `SHA256:y18Q4iSII8m7/+FCRyx///jWV/oZ70b8iGBnOosRuA0` |

Both are 2048-bit RSA, both passphrase-less.

## What they open — confirmed from shell history

These are **Oracle Cloud** VMs, left over from the Beam scraping era
before everything moved to Cloudflare Workers:

| Key | Host |
|---|---|
| `ssh-key-2026-07-25` | `ubuntu@159.13.49.46` |
| `ssh-key-2026-07-27` | `ubuntu@136.114.9.5` |
| `ssh-key-2026-07-27` | `ubuntu@149.118.67.110` |
| `ssh-key-2026-07-27` | `ubuntu@158.178.142.156` |

Separately, and NOT compromised — these keys were never committed:

- Google Cloud VMs `beamchat-vm` and `givesachat`, zone `us-central1-a`,
  reached with `gcloud compute ssh` and `~/.ssh/beamchat`
- `35.224.169.125`, `136.111.186.250` (GCP)

Nothing in the current pipeline uses any of this. `.github/workflows/deploy.yml`
deploys with a `CLOUDFLARE_API_TOKEN` GitHub secret, not SSH.

## Prefer deletion over rotation

If these instances are no longer used — and nothing suggests they are —
**terminate them instead of rotating keys**. A destroyed VM cannot be
logged into by anyone, which is a stronger guarantee than an
`authorized_keys` edit, and it stops any billing.

Check every region; Oracle scatters instances and these IPs do not all
look like the same one.

- Oracle Cloud → Compute → Instances
- Google Cloud → Compute Engine → VM instances → us-central1-a

Rotate only on a machine you are actively using. The steps below cover
that case.

Which are still alive:

```bash
for ip in 159.13.49.46 136.114.9.5 149.118.67.110 158.178.142.156; do
  printf "%-16s " "$ip"
  nc -z -w3 "$ip" 22 2>/dev/null && echo "SSH OPEN — still up" || echo "no response"
done
```

## The thing to understand first

Deleting the file, rewriting history, or making the repo private does
**not** undo this. The keys were published. Anyone who cloned or
scraped the repo has them, GitHub retains unreferenced objects, and
mirrors exist.

**Rotation is the only remedy.** Everything else is tidying.

Treat these as burned regardless of what happens to the git history.

---

## 1. Find where the key is authorised

If you know the server, SSH in using the old key while it still works:

```bash
ssh -i keys/ssh-key-2026-07-27.key <user>@<host>
```

Once in, look at what is trusted:

```bash
cat ~/.ssh/authorized_keys
ssh-keygen -lf ~/.ssh/authorized_keys        # fingerprints of each entry
```

Match against `SHA256:y18Q4iSII8m7/+FCRyx///jWV/oZ70b8iGBnOosRuA0`.
Check for the 07-25 key's entry too — it may still be there.

Also check the provider's console: Oracle Cloud, Azure and DigitalOcean
all keep a list of saved public keys separately from the instance.

If you cannot work out what these open, say so — a key that opens
nothing is a much smaller problem, but "I don't remember" is not the
same as "nothing".

## 2. Generate a replacement

Ed25519, not RSA. Shorter, faster, and no key-size question to get
wrong:

```bash
ssh-keygen -t ed25519 -a 100 -C "givesachat-$(date +%Y-%m-%d)" \
  -f ~/.ssh/givesachat_ed25519
```

**Set a passphrase when prompted.** The old keys had none, which is why
committing one was immediately fatal rather than merely bad.

This writes to `~/.ssh/`, outside the repository. Nothing that lives in
a git working tree should ever hold a private key again.

## 3. Authorise the new key

From your Mac, while the old key still works:

```bash
ssh-copy-id -i ~/.ssh/givesachat_ed25519.pub -o IdentityFile=keys/ssh-key-2026-07-27.key <user>@<host>
```

Or manually: paste the contents of `~/.ssh/givesachat_ed25519.pub` onto
its own line in `~/.ssh/authorized_keys` on the server.

## 4. Test the new key BEFORE removing the old one

In a **separate terminal**, leaving your existing session open:

```bash
ssh -i ~/.ssh/givesachat_ed25519 <user>@<host>
```

Do not skip this. Removing the old key from a session you then lose is
how people lock themselves out of a machine permanently.

## 5. Remove the old keys

With the new key confirmed working, on the server:

```bash
nano ~/.ssh/authorized_keys      # delete the 07-25 and 07-27 lines
```

Then in the provider's console, delete the saved public keys too.

Verify they no longer work:

```bash
ssh -i keys/ssh-key-2026-07-27.key <user>@<host>
# expected: Permission denied (publickey)
```

**That "Permission denied" is the moment this is actually fixed.**

## 6. Delete the local copies

```bash
rm -rf keys/
```

They are already untracked and gitignored, so nothing will re-add them.

## 7. Optional: purge from git history

Only worth doing after steps 1–5. It does not reduce exposure; it stops
the next person who reads the repo from finding a key and wondering.

```bash
brew install git-filter-repo
git filter-repo --path keys/ --invert-paths
git push --force --all
```

Caveats: this rewrites every commit hash after the first key commit,
requires a force push, and GitHub may keep the old objects reachable
until it garbage-collects. Anyone with an existing clone keeps the old
history. Again: **the keys are compromised whatever you do here.**

---

## Also worth checking while you are in there

- `~/.ssh/authorized_keys` on any other machine you administer, in case
  the same key was reused
- Whether either key was added to a GitHub account
  (github.com → Settings → SSH and GPG keys) — a compromised key there
  means push access to your repositories
- Server logs for logins you do not recognise since 26 July 2026:
  `last -20` and `sudo grep "Accepted publickey" /var/log/auth.log`
