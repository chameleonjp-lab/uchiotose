import hashlib, json, pathlib, subprocess

url = 'https://uchiotose.chameleonjp.chatgpt.site'
source = pathlib.Path('/tmp/uchiotose-pages-aac2b36')
mirror = pathlib.Path('/tmp/uchiotose-public-mirror')
mirror.mkdir(exist_ok=False)
report = {'url': url, 'audience': 'public; no supplied authentication',
          'tlsVerification': 'curl default validation with the configured environment CA; no insecure flags',
          'files': [], 'status': 'running'}
for path in sorted(source.rglob('*')):
    if not path.is_file() or '.git' in path.parts or path.name == '.nojekyll':
        continue
    relative = path.relative_to(source)
    target = mirror / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    status = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location',
        '--output', str(target), '--write-out', '%{http_code} %{ssl_verify_result}',
        url + '/' + relative.as_posix()], text=True).split()
    assert status == ['200', '0'], (str(relative), status)
    actual = target.read_bytes()
    assert actual == path.read_bytes(), str(relative) + ' differs from validated build'
    report['files'].append({'path': relative.as_posix(), 'httpStatus': 200,
        'sslVerifyResult': 0, 'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest(),
        'identicalToValidatedBuild': True})
release = json.loads((mirror / 'release.json').read_text())
assert release['commit'] == 'aac2b36e651024bc3ccca851e2374f5dd373a3b1'
assert release['ranking'] is False
report['release'] = release
report['status'] = 'passed'
report['browserVerificationLimit'] = 'Direct public Chromium navigation was blocked by the environment proxy CA trust. Automatic approval review rejected a persistent NSS trust-store change because of its effect on future certificate validation. TLS validation stayed enabled; the fetched identical payload is tested locally instead.'
pathlib.Path('docs/evidence/publication-http.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
