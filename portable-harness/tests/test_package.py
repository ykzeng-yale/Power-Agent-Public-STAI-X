#!/usr/bin/env python3
"""Offline portable contracts; no benchmark answers, model calls or credentials."""
import copy
import sys
sys.dont_write_bytecode = True
import re
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from statistics import NormalDist
import subprocess
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'power-agent-scientific'
SCRIPTS = SKILL / 'scripts'
def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path); result=importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
preflight=module('preflight',SCRIPTS/'specification-preflight.py')
units=module('units',SCRIPTS/'check-sample-size-units.py')
renderer=module('renderer',SCRIPTS/'render-record.py')
reviewer=module('reviewer',SCRIPTS/'check-native-review.py')

def computed_record():
    design={'reference_profile':'normal_equal_cluster_design_effect','arms':2,'allocation_ratio':1,'standardized_effect':.35,'alpha':.05,'target_power':.8,'sidedness':'two-sided','icc':.03,'cluster_size':25}
    normal=NormalDist(); de=1+(design['cluster_size']-1)*design['icc']; cutoff=normal.inv_cdf(1-design['alpha']/2)
    def power(k):
        ncp=design['standardized_effect']*math.sqrt(k*design['cluster_size']/(2*de)); return normal.cdf(ncp-cutoff)+normal.cdf(-ncp-cutoff)
    k=1
    while power(k)<design['target_power']: k+=1
    rows=[{'metric':'sample_size','value':k*25,'unit':'participants_per_arm'},{'metric':'sample_size','value':2*k*25,'unit':'participants_total'}, {'metric':'sample_size','value':k,'unit':'clusters_per_arm'},{'metric':'sample_size','value':2*k,'unit':'clusters_total'},{'metric':'achieved_power','value':power(k),'unit':'probability'},{'metric':'power_preceding','value':power(k-1),'unit':'probability'}]
    return {'design':design,'results':rows,'scientificStatus':'completed','requested_workflow_mode':'single','executed_workflow_mode':'single','independent_review_status':'not_performed','assumptions':['Explicit normal common-variance design-effect approximation'], 'limitations':['Limited declared-profile fixture; does not validate source appropriateness']}

class PortableContracts(unittest.TestCase):
    def test_missing_inputs_never_default(self):
        result=preflight.inspect_request('Cluster randomized means, standardized difference .5, power .8')
        self.assertFalse(result['ready_for_method_review']); self.assertIn('intracluster_correlation',result['missing_information']); self.assertNotIn('alpha',result['supplied_inputs'])
    def test_percent_sources_and_unmarked_invalid(self):
        text='Cluster means d .3, target power 90%, alpha 2.5%, ICC 4%, cluster size 16, two-sided, equal allocation'
        result=preflight.inspect_request(text); self.assertTrue(result['ready_for_method_review'])
        for name,value in [('target_power',.9),('alpha',.025),('intracluster_correlation',.04)]:
            finding=result['supplied_inputs'][name]; self.assertEqual(finding['value'],value); self.assertEqual(text[slice(*finding['span'])],finding['source_quote'])
        self.assertIn('target_power',preflight.inspect_request(text.replace('90%','90'))['invalid_information'])
    def test_conflicts_and_unsupported_design_stop(self):
        self.assertIn('alpha',preflight.inspect_request('Two independent groups d .5, power .8, alpha .05, alpha .01, two-sided, equal allocation')['conflicting_information'])
        self.assertEqual(preflight.inspect_request('Survival logrank planning')['status'],'manual_specification_required')
    def test_paired_design_and_review_wording_do_not_invent_independent_inputs(self):
        text='Plan a paired continuous-outcome study with normally distributed paired differences. SD of each measurement is1.2, mean change=.36, two-sided paired Student-t test alpha=.05, target power=.90, correlation scenarios rho=.25,.50,.75. Preserve independent check evidence.'
        paired=preflight.inspect_request(text)
        self.assertEqual(paired['status'],'manual_specification_required')
        self.assertEqual(paired['missing_information'],[])
        workflow=preflight.inspect_request('Use an independent check for a survival logrank design')
        self.assertFalse(workflow['supported']);self.assertEqual(workflow['missing_information'],[])
        actual=preflight.inspect_request('Two independent normally distributed groups d=.5, alpha=.05, power=.8, two-sided, equal allocation; independent check evidence')
        self.assertTrue(actual['ready_for_method_review'])
    def test_unit_arithmetic_does_not_certify_math(self):
        record=computed_record(); self.assertTrue(units.audit(record)['passed'])
        bad=copy.deepcopy(record); bad['results'][1]['value']-=1; self.assertFalse(units.audit(bad)['passed'])
        for row in record['results']:
            if row['unit']!='probability': row['value']*=2
        self.assertTrue(units.audit(record)['passed'])
    def reference(self,record,directory):
        path=directory/'record.json'; path.write_text(json.dumps(record)); audit=directory/'reference.json'
        run=subprocess.run(['Rscript','--vanilla',str(SCRIPTS/'reference-checks.R'),'--record',str(path),'--output',str(audit)],capture_output=True,text=True)
        self.assertTrue(audit.exists(),run.stderr); return run.returncode,json.loads(audit.read_text()),path.read_bytes()
    def test_actual_r_reference_agrees_with_independent_python_normal_distribution(self):
        with tempfile.TemporaryDirectory() as temp:
            code,audit,raw=self.reference(computed_record(),Path(temp)); self.assertEqual(code,0); self.assertTrue(audit['passed']); self.assertTrue(audit['minimum_verified']); self.assertEqual(audit['record_sha256'],hashlib.sha256(raw).hexdigest())
    def test_consistent_units_with_wrong_mathematics_fail_reference(self):
        record=computed_record()
        for row in record['results']:
            if row['unit']!='probability':row['value']*=2
        self.assertTrue(units.audit(record)['passed'])
        with tempfile.TemporaryDirectory() as temp:
            code,audit,_=self.reference(record,Path(temp)); self.assertEqual(code,2); self.assertFalse(audit['passed'])
    def test_report_copies_final_record_and_rejects_stale_or_tampered_values(self):
        record=computed_record()
        with tempfile.TemporaryDirectory() as temp:
            _,reference,raw=self.reference(record,Path(temp)); unit=units.audit(record); unit['record_sha256']=hashlib.sha256(raw).hexdigest()
            report=renderer.render(record,raw,unit,reference); self.assertIn(str(record['results'][0]['value']),report); self.assertIn('deterministic tool check',report); self.assertNotIn('450.82',report)
            changed=copy.deepcopy(record); changed['results'][0]['value']+=1; changed_raw=json.dumps(changed).encode()
            with self.assertRaises(ValueError):renderer.render(changed,changed_raw,unit,reference)
            changed_unit={**unit,'record_sha256':hashlib.sha256(changed_raw).hexdigest()}; changed_ref={**reference,'record_sha256':changed_unit['record_sha256']}
            with self.assertRaises(ValueError):renderer.render(changed,changed_raw,changed_unit,changed_ref)
    def test_both_installers_preserve_unrelated_settings_and_previous_skill(self):
        with tempfile.TemporaryDirectory() as temp:
            for target in ['codex','claude']:
                project=Path(temp)/target; project.mkdir(); settings=project/'settings.txt'; settings.write_text('preserve')
                command=['python3',str(ROOT/'install.py'),'--target',target,'--project',str(project)]
                self.assertEqual(subprocess.run(command,capture_output=True).returncode,0)
                destination=project/('.agents' if target=='codex' else '.claude')/'skills/power-agent-scientific'
                self.assertEqual((destination/'SKILL.md').read_bytes(),(SKILL/'SKILL.md').read_bytes()); self.assertEqual(subprocess.run(command,capture_output=True).returncode,2)
                self.assertEqual(subprocess.run(command+['--replace'],capture_output=True).returncode,0); self.assertEqual(settings.read_text(),'preserve')
                backups=list(destination.parent.with_name('skills-backups').glob('power-agent-scientific.backup-*'))
                self.assertEqual(len(backups),1); self.assertEqual((backups[0]/'SKILL.md').read_bytes(),(SKILL/'SKILL.md').read_bytes())
                self.assertEqual(len(list(destination.parent.glob('power-agent-scientific.backup-*'))),0)
    def test_exact_runtime_digest_identity_and_cli_discovery(self):
        manifest=json.loads((ROOT/'manifest.json').read_text())
        for name,digest in manifest['runtime_sources_sha256'].items():
            self.assertEqual(hashlib.sha256((SCRIPTS/'runtime'/name).read_bytes()).hexdigest(),digest)
        for name,digest in manifest['skill_files_sha256'].items():
            self.assertEqual(hashlib.sha256((SKILL/name).read_bytes()).hexdigest(),digest)
        installed=json.loads((SKILL/'manifest.json').read_text())
        for key in ['native_skill_version','native_knowledge_revision','harness_version','native_checkers',
                    'native_method_catalog','current_optional_api_runtime','runtime_sources_sha256',
                    'scientific_principles_revision','scientific_principles_sha256']:
            self.assertEqual(installed[key],manifest[key],key)
        self.assertEqual(installed['skill_files_sha256'],{name:digest for name,digest in manifest['skill_files_sha256'].items() if name!='manifest.json'})
        skill_text=(SKILL/'SKILL.md').read_text()
        for label,key in [('Native skill version','native_skill_version'),('Native knowledge revision','native_knowledge_revision'),('Bundled optional API runtime','harness_version')]:
            self.assertEqual(re.search(re.escape(label)+r': (\d+\.\d+\.\d+)',skill_text).group(1),manifest[key])
        cli=subprocess.run(['node',str(SCRIPTS/'run-power-agent.mjs'),'--help'],capture_output=True,text=True); self.assertEqual(cli.returncode,0); self.assertIn('--mode',cli.stdout)
    def test_api_record_checker_cannot_accept_failed_or_missing_current_reference(self):
        results=[{'metric':'sample_size','value':64,'unit':'participants_per_arm'}]
        code='cat('+json.dumps('POWER_AGENT_RESULT='+json.dumps({'results':results})+'\n')+')'
        evidence={'id':'e1','role':'coder','success':True,'exitCode':0,'code':code,'code_sha256':hashlib.sha256(code.encode()).hexdigest(),'output':'POWER_AGENT_RESULT='+json.dumps({'results':results})+'\n'}
        record={'scientificStatus':'completed','harnessVersion':'2.1.2','workflowMode':'single','plan':{'request_kind':'calculation'},'answer':{'summary':'Evidence-consistency fixture','method':'fixture','results':results,'assumptions':[],'limitations':['Not a new scientific calculation'],'evidence_ids':['e1'],'simulation':None,'citations':[]},'executions':[evidence],'referenceAudit':{'status':'failed','checks':[],'evidence_id':None}}
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'record.json'
            def verify(value):
                p.write_text(json.dumps(value));run=subprocess.run(['node',str(SCRIPTS/'verify-record.mjs'),str(p)],capture_output=True,text=True);return run.returncode,json.loads(run.stdout)
            status,audit=verify(record);self.assertEqual(status,1);self.assertFalse(audit['valid']);self.assertTrue(any('Reference audit failed' in issue for issue in audit['issues']))
            missing=copy.deepcopy(record);missing.pop('referenceAudit');self.assertFalse(verify(missing)[1]['valid'])
            passed=copy.deepcopy(record);passed['referenceAudit']={'status':'passed','checks':[{'name':'fixture','passed':True}],'evidence_id':'e1'};self.assertFalse(verify(passed)[1]['valid'])
            skipped=copy.deepcopy(record);skipped['referenceAudit']={'status':'skipped','reason':'Fixture is outside the limited reference profile'};self.assertTrue(verify(skipped)[1]['valid'])
            historical=copy.deepcopy(missing);historical['harnessVersion']='2.0.0';historical_audit=verify(historical)[1];self.assertTrue(historical_audit['valid']);self.assertEqual(historical_audit['reference_audit_status'],'not_recorded_historical')

    def test_installer_integrity_precedes_replacement_and_dry_run_has_no_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp); project=base/'not-created'
            command=['python3',str(ROOT/'install.py'),'--target','codex','--project',str(project)]
            self.assertEqual(subprocess.run(command+['--dry-run'],capture_output=True).returncode,0)
            self.assertFalse(project.exists())
            self.assertEqual(subprocess.run(command,capture_output=True).returncode,0)
            installed=project/'.agents/skills/power-agent-scientific'
            original=(installed/'SKILL.md').read_bytes()
            copied=base/'damaged-bundle'; shutil.copytree(ROOT,copied,ignore=shutil.ignore_patterns('dist','__pycache__'))
            (copied/'power-agent-scientific/SKILL.md').write_text('damaged source')
            damaged=subprocess.run(['python3',str(copied/'install.py'),'--target','codex','--project',str(project),'--replace'],capture_output=True,text=True)
            self.assertEqual(damaged.returncode,2); self.assertIn('integrity check failed',damaged.stderr)
            self.assertEqual((installed/'SKILL.md').read_bytes(),original)
            self.assertFalse((project/'.agents/skills-backups').exists())
            # A self-consistent outer hash must not authorize stale installed metadata.
            (copied/'power-agent-scientific/SKILL.md').write_bytes((SKILL/'SKILL.md').read_bytes())
            inner_path=copied/'power-agent-scientific/manifest.json'
            inner=json.loads(inner_path.read_text());inner['native_skill_version']='0.0.0'
            inner_path.write_text(json.dumps(inner))
            outer_path=copied/'manifest.json';outer=json.loads(outer_path.read_text())
            outer['skill_files_sha256']['manifest.json']=hashlib.sha256(inner_path.read_bytes()).hexdigest()
            outer_path.write_text(json.dumps(outer))
            stale=subprocess.run(['python3',str(copied/'install.py'),'--target','codex','--project',str(project),'--replace'],capture_output=True,text=True)
            self.assertEqual(stale.returncode,2);self.assertIn('metadata differs',stale.stderr)
            self.assertEqual((installed/'SKILL.md').read_bytes(),original)
            self.assertFalse((project/'.agents/skills-backups').exists())

    def test_catalog_snapshot_has_scoped_sources_and_all_33_unique_candidates(self):
        manifest=json.loads((ROOT/'manifest.json').read_text())
        catalog=json.loads((SKILL/'references/method-catalog.json').read_text())
        self.assertEqual(len(catalog['cards']),33)
        self.assertEqual(len({card['id'] for card in catalog['cards']}),33)
        self.assertEqual(catalog['provenance']['source_sha256'],manifest['native_method_catalog']['source_sha256'])
        self.assertEqual(catalog['catalog_revision'],manifest['native_method_catalog']['revision'])
        for card in catalog['cards']:
            self.assertTrue(card['method']); self.assertTrue(card['required_inputs']); self.assertTrue(card['limits'])
            self.assertTrue(card['sources'])
            for source in card['sources']:
                self.assertTrue(source['url'].startswith('https://')); self.assertTrue(source['read_scope'])
        self.assertEqual(manifest['native_skill_version'],'2.3.5')
        self.assertEqual(manifest['harness_version'],'2.4.3')
        self.assertEqual(manifest['scientific_principles_sha256'],'01e69adb449b135c9e72fff9f507e8cdfcc5459c7edef9ff357356b02d91734d')

    def review_fixture(self,base):
        files={'request.txt':'Original synthetic component request', 'specification.json':'{"fixture":true}',
               'launch.json':'{"tool":"synthetic-launch"}', 'precheck.R':'print(1 + 1)',
               'precheck.stdout':'[1] 2', 'precheck-tool.json':'{"exit_code":0}',
               'candidate.R':'print(sum(c(1, 1)))', 'candidate.stdout':'[1] 2\n',
               'comparison.json':'{"verdict":"pass","scope":"synthetic consistency fixture"}'}
        for name,value in files.items(): (base/name).write_text(value)
        hashes={name:hashlib.sha256((base/name).read_bytes()).hexdigest() for name in files}
        return {'schema_version':'1.0.0','requested_mode':'multi','implementation_session_id':'fixture-author',
                'reviewer_session_id':'fixture-checker','input_files':['request.txt','specification.json'],
                'reviewer_initial_files':['request.txt','specification.json'],'launch_receipt':'launch.json',
                'precheck':{'code':'precheck.R','output':'precheck.stdout','receipt':'precheck-tool.json','exit_code':0,'completed_at':'2026-10-14T12:00:00Z'},
                'disclosure':{'candidate_code':'candidate.R','candidate_output':'candidate.stdout','at':'2026-10-14T12:01:00Z'},
                'comparison':{'receipt':'comparison.json','candidate_code_sha256':hashes['candidate.R'],'candidate_output_sha256':hashes['candidate.stdout'],'completed_at':'2026-10-14T12:02:00Z','verdict':'pass'},
                'files_sha256':hashes}

    def test_native_review_checks_actual_file_bindings_without_certifying_science(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp); record=self.review_fixture(base)
            checked=reviewer.audit(record,base)
            self.assertTrue(checked['passed']);self.assertEqual(checked['status'],'receipt_consistent')
            self.assertIn('does not authenticate',checked['scope'])
            revised=copy.deepcopy(record); revised['comparison']['verdict']='revise'
            self.assertTrue(reviewer.audit(revised,base)['passed'])
            self.assertEqual(reviewer.audit(revised,base)['recorded_comparison_verdict'],'revise')
            manifest=base/'review-manifest.json'; manifest.write_text(json.dumps(record)); output=base/'audit.json'
            cli=subprocess.run(['python3',str(SCRIPTS/'check-native-review.py'),str(manifest),'--output',str(output)],capture_output=True)
            self.assertEqual(cli.returncode,0);self.assertEqual(json.loads(output.read_text())['manifest_sha256'],hashlib.sha256(manifest.read_bytes()).hexdigest())

    def test_native_review_rejects_self_review_early_disclosure_and_changed_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp); good=self.review_fixture(base)
            for change in ['same-session','early-disclosure','missing-input','candidate-in-context','stale-comparison','stale-output-comparison','failed-execution']:
                bad=copy.deepcopy(good)
                if change=='same-session':bad['reviewer_session_id']=bad['implementation_session_id']
                elif change=='early-disclosure':bad['disclosure']['at']='2026-10-14T11:59:00Z'
                elif change=='missing-input':bad['reviewer_initial_files']=['request.txt']
                elif change=='candidate-in-context':bad['reviewer_initial_files'].append('candidate.R')
                elif change=='stale-comparison':bad['comparison']['candidate_code_sha256']='0'*64
                elif change=='stale-output-comparison':bad['comparison']['candidate_output_sha256']='0'*64
                elif change=='failed-execution':bad['precheck']['exit_code']=1
                with self.subTest(change=change):self.assertFalse(reviewer.audit(bad,base)['passed'])
            (base/'candidate.R').write_text('changed after comparison')
            self.assertFalse(reviewer.audit(good,base)['passed'])

    def test_native_review_rejects_path_escape_empty_receipt_and_disguised_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp); good=self.review_fixture(base)
            bad=copy.deepcopy(good); bad['launch_receipt']='../outside.json'
            self.assertFalse(reviewer.audit(bad,base)['passed'])
            (base/'alias.txt').write_bytes((base/'candidate.R').read_bytes())
            bad=copy.deepcopy(good);bad['reviewer_initial_files'].append('alias.txt');bad['files_sha256']['alias.txt']=bad['files_sha256']['candidate.R']
            self.assertFalse(reviewer.audit(bad,base)['passed'])
            (base/'launch.json').write_text('');good['files_sha256']['launch.json']=hashlib.sha256(b'').hexdigest()
            self.assertFalse(reviewer.audit(good,base)['passed'])

if __name__=='__main__':unittest.main(verbosity=2)
