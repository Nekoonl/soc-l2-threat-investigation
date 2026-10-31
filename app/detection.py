"""Deterministic heuristics. Findings indicate suspicion, never confirmed compromise."""
import hashlib
import re
from collections import Counter, defaultdict

from .time_policy import TimePolicy

RULES = [
    {'id': 'AUTH-001', 'name': 'Fuerza bruta', 'technique': 'T1110', 'tactic': 'Acceso a credenciales', 'score': 70,
     'condition': '5 o más fallos del mismo origen, usuario y host en 5 minutos.',
     'limitations': 'Puede corresponder a una contraseña desactualizada o una aplicación mal configurada.'},
    {'id': 'AUTH-002', 'name': 'Acceso tras múltiples fallos', 'technique': 'T1078', 'tactic': 'Acceso inicial', 'score': 92,
     'condition': 'Inicio de sesión exitoso precedido por 5 o más fallos del mismo origen, usuario y host en 10 minutos.',
     'limitations': 'El éxito no confirma una intrusión. Verifica identidad, MFA y contexto del activo.'},
    {'id': 'AUTH-003', 'name': 'Posible password spraying', 'technique': 'T1110.003', 'tactic': 'Acceso a credenciales', 'score': 78,
     'condition': 'Fallos contra 5 o más usuarios diferentes desde una IP en 10 minutos.',
     'limitations': 'Sin conocer la contraseña utilizada, la técnica es una hipótesis de clasificación.'},
    {'id': 'NET-001', 'name': 'Exploración de puertos', 'technique': 'T1046', 'tactic': 'Descubrimiento', 'score': 58,
     'condition': '10 o más puertos de destino distintos desde una IP hacia el mismo destino en 2 minutos.',
     'limitations': 'Puede ser un escáner de vulnerabilidades autorizado. Validar con el inventario.'},
    {'id': 'EXEC-001', 'name': 'PowerShell sospechoso', 'technique': 'T1059.001', 'tactic': 'Ejecución', 'score': 82,
     'condition': 'PowerShell/pwsh o evento 4104 con codificación, DownloadString, Invoke-Expression, IEX o bypass.',
     'limitations': 'Son indicadores de comando; no se ejecuta ni decodifica el contenido. Revisar scripts administrativos.'},
]
RULE_BY_ID = {rule['id']: rule for rule in RULES}


def epoch(event, *, time_policy=None):
    return (time_policy or TimePolicy()).seconds(event)


def auth_result(event):
    if event['event_id'] == '4625':
        return 'failure'
    if event['event_id'] == '4624':
        return 'success'
    # A successful process/connection is not a successful authentication.
    if event['event_id']:
        return ''
    event_tokens = set(re.split(r'[^a-z0-9]+', event['event_type'].lower()))
    if event_tokens and event['event_type'] and not event_tokens & {'login', 'logon', 'auth', 'authentication', 'autenticacion', 'ssh', 'rdp', 'inicio'}:
        return ''
    tokens = re.split(r'[^a-z0-9]+', f"{event['status']} {event['event_type']}".lower())
    if set(tokens) & {'failed', 'failure', 'denied', 'fallido', 'fallo', 'rechazado'}:
        return 'failure'
    if set(tokens) & {'success', 'successful', 'exitoso', 'exito', 'accepted'}:
        return 'success'
    return ''


def window_matches(events, seconds, minimum, distinct=None, *, time_policy=None):
    """Never combine clocks or use an unapproved, unzoned wall clock."""
    policy = time_policy or TimePolicy()
    groups, _ = policy.partition(events)
    for group in groups:
        yield from _window_matches(group, seconds, minimum, distinct, policy)


def _window_matches(events, seconds, minimum, distinct, policy):
    """Merge overlapping qualifying rolling windows into one evidence-backed episode."""
    ordered = sorted(events, key=policy.seconds)
    times = [policy.seconds(e) for e in ordered]
    left, episode_start, episode_end = 0, None, None
    counts = Counter()
    for right, event in enumerate(ordered):
        if distinct:
            counts[event[distinct]] += 1
        while times[right] - times[left] > seconds:
            if distinct:
                value = ordered[left][distinct]
                counts[value] -= 1
                if counts[value] == 0:
                    del counts[value]
            left += 1
        qualifies = len(counts) >= minimum if distinct else right-left+1 >= minimum
        if qualifies:
            if episode_start is not None and left > episode_end:
                yield ordered[episode_start:episode_end+1]
                episode_start = None
            if episode_start is None:
                episode_start = left
            episode_end = right
    if episode_start is not None:
        yield ordered[episode_start:episode_end+1]


def finding(rule_id, events, explanation, *, time_policy=None):
    policy = time_policy or TimePolicy()
    rule = RULE_BY_ID[rule_id]
    ordered = sorted(events, key=lambda e: (policy.timestamp(e), e['id']))
    identity = f"{rule_id}:" + ','.join(str(e['id']) for e in ordered)
    digest = hashlib.sha256(identity.encode()).hexdigest()[:12]
    score = rule['score']
    return {
        'id': f'INC-{digest.upper()}', 'rule_id': rule_id, 'title': rule['name'],
        'technique': rule['technique'], 'tactic': rule['tactic'], 'score': score,
        'severity': 'critical' if score >= 90 else 'high' if score >= 70 else 'medium' if score >= 40 else 'low',
        'first_seen': policy.timestamp(ordered[0]), 'last_seen': policy.timestamp(ordered[-1]),
        'time_basis': policy.describe(events),
        'src_ip': next((e['src_ip'] for e in ordered if e['src_ip']), ''),
        'username': next((e['username'] for e in ordered if e['username']), ''),
        'hostname': next((e['hostname'] for e in ordered if e['hostname']), ''),
        'explanation': explanation, 'limitations': rule['limitations'],
        'evidence_ids': [e['id'] for e in ordered], 'event_count': len(ordered),
    }


def detect(events, *, time_policy=None):
    """Run existing rules separately per comparable clock, only when called.

    Unknown/invalid clocks cannot qualify temporal windows. Individual command
    indicators remain inspectable and carry an unavailable temporal basis.
    """
    policy = time_policy or TimePolicy()
    groups, unavailable = policy.partition(events)
    groups.extend([event] for event in unavailable)
    findings = [item for group in groups for item in _detect(group, policy)]
    return sorted(findings, key=lambda item: (-item['score'], item['first_seen']))


def _detect(events, policy):
    failures, spray, network = defaultdict(list), defaultdict(list), defaultdict(list)
    successes, powershell = [], []
    for event in events:
        result = auth_result(event)
        if event['src_ip'] and event['username']:
            identity = (event['src_ip'], event['username'], event['hostname'])
            if result == 'failure':
                failures[identity].append(event)
                spray[event['src_ip']].append(event)
            elif result == 'success':
                successes.append(event)
        if event['src_ip'] and event['dst_ip'] and event['dst_port']:
            network[(event['src_ip'], event['dst_ip'])].append(event)
        text = f"{event['event_type']} {event['message']}".lower()
        is_ps = bool(re.search(r'\b(?:powershell|pwsh)(?:\.exe)?\b', text)) or event['event_id'] == '4104'
        suspicious = re.search(r'(?<!\w)-(?:enc|encodedcommand|encoded)\b|downloadstring|invoke-expression|\biex\b|executionpolicy\s+bypass', text)
        if is_ps and suspicious:
            powershell.append(event)
    findings = []
    for group in failures.values():
        for evidence in window_matches(group, 300, 5, time_policy=policy):
            findings.append(finding('AUTH-001', evidence, 'Se observaron al menos 5 fallos en una ventana de 5 minutos para el mismo origen, usuario y host.', time_policy=policy))
    for success in successes:
        group = failures[(success['src_ip'], success['username'], success['hostname'])]
        evidence = [e for e in group if 0 <= policy.seconds(success) - policy.seconds(e) <= 600]
        if len(evidence) >= 5:
            findings.append(finding('AUTH-002', evidence + [success], f"Un acceso exitoso fue precedido por {len(evidence)} fallos en 10 minutos; posible uso de credenciales válidas.", time_policy=policy))
    for group in spray.values():
        for evidence in window_matches(group, 600, 5, 'username', time_policy=policy):
            findings.append(finding('AUTH-003', evidence, f"La misma IP intentó autenticarse sin éxito contra {len({e['username'] for e in evidence})} cuentas; se cumple un umbral de 5 cuentas en 10 minutos.", time_policy=policy))
    for group in network.values():
        for evidence in window_matches(group, 120, 10, 'dst_port', time_policy=policy):
            findings.append(finding('NET-001', evidence, 'Se alcanzó el umbral de 10 puertos diferentes hacia el mismo destino en 2 minutos.', time_policy=policy))
    for event in powershell:
        findings.append(finding('EXEC-001', [event], 'El comando contiene PowerShell y un indicador de codificación, descarga o ejecución dinámica.', time_policy=policy))
    return sorted(findings, key=lambda f: (-f['score'], f['first_seen']))


def correlate(incidents, evidence_by_id, *, time_policy=None):
    """Link within 30 minutes by shared evidence, source IP, or user AND host."""
    links = {i['id']: [] for i in incidents}
    policy = time_policy or TimePolicy()
    entities, intervals = {}, {}
    for item in incidents:
        evidence = [evidence_by_id[eid] for eid in item['evidence_ids'] if eid in evidence_by_id]
        # Historical first_seen/last_seen can contain a fabricated UTC suffix.
        # Derive bounds from complete, comparable source evidence instead.
        intervals[item['id']] = policy.interval(evidence) if len(evidence) == len(item['evidence_ids']) else None
        entities[item['id']] = {
            'src': {e['src_ip'] for e in evidence if e['src_ip']},
            'identities': {(e['username'], e['hostname']) for e in evidence if e['username'] and e['hostname']},
        }
    for index, left in enumerate(incidents):
        for right in incidents[index + 1:]:
            left_time, right_time = intervals[left['id']], intervals[right['id']]
            if left_time is None or right_time is None or left_time[0] != right_time[0]:
                continue
            gap = max(left_time[1], right_time[1]) - min(left_time[2], right_time[2])
            if gap > 1800:
                continue
            reasons = []
            if set(left['evidence_ids']) & set(right['evidence_ids']):
                reasons.append('eventos compartidos')
            if entities[left['id']]['src'] & entities[right['id']]['src']:
                reasons.append('IP de origen compartida')
            if entities[left['id']]['identities'] & entities[right['id']]['identities']:
                reasons.append('usuario y host compartidos')
            if reasons:
                links[left['id']].append({'id': right['id'], 'title': right['title'], 'reasons': reasons})
                links[right['id']].append({'id': left['id'], 'title': left['title'], 'reasons': reasons})
    return links
