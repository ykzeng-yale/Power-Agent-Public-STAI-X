#!/usr/bin/env python3
"""Offline portable contracts; no benchmark answers, model calls or credentials."""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from statistics import NormalDist
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'portable-harness/power-agent-scientific'
SCRIPTS = SKILL / 'scripts'
def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path); result=importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
preflight=module('preflight',SCRIPTS/'specification-preflight.py')
units=module('units',SCRIPTS/'check-sample-size-units.py')
renderer=module('renderer',SCRIPTS/'render-record.py')

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
            report=renderer.render(record,raw,unit,reference); self.assertIn('225',report); self.assertIn('deterministic tool check',report); self.assertNotIn('450.82',report)
            changed=copy.deepcopy(record); changed['results'][0]['value']+=1; changed_raw=json.dumps(changed).encode()
            with self.assertRaises(ValueError):renderer.render(changed,changed_raw,unit,reference)
            changed_unit={**unit,'record_sha256':hashlib.sha256(changed_raw).hexdigest()}; changed_ref={**reference,'record_sha256':changed_unit['record_sha256']}
            with self.assertRaises(ValueError):renderer.render(changed,changed_raw,changed_unit,changed_ref)
    def test_both_installers_preserve_unrelated_settings_and_previous_skill(self):
        with tempfile.TemporaryDirectory() as temp:
            for target in ['codex','claude']:
                project=Path(temp)/target; project.mkdir(); settings=project/'settings.txt'; settings.write_text('preserve')
                command=['python3',str(ROOT/'portable-harness/install.py'),'--target',target,'--project',str(project)]
                self.assertEqual(subprocess.run(command,capture_output=True).returncode,0)
                destination=project/('.codex' if target=='codex' else '.claude')/'skills/power-agent-scientific'
                self.assertEqual((destination/'SKILL.md').read_bytes(),(SKILL/'SKILL.md').read_bytes()); self.assertEqual(subprocess.run(command,capture_output=True).returncode,2)
                self.assertEqual(subprocess.run(command+['--replace'],capture_output=True).returncode,0); self.assertEqual(settings.read_text(),'preserve'); self.assertEqual(len(list(destination.parent.glob('power-agent-scientific.backup-*'))),1)
    def test_exact_runtime_digest_identity_and_cli_discovery(self):
        manifest=json.loads((ROOT/'scientific/manifest.json').read_text())
        for name,digest in manifest['core_sources_sha256'].items():
            a=(ROOT/'scientific'/name).read_bytes(); b=(SCRIPTS/'runtime'/name).read_bytes(); self.assertEqual(a,b); self.assertEqual(hashlib.sha256(a).hexdigest(),digest)
        cli=subprocess.run(['node',str(ROOT/'scripts/run-scientific.mjs'),'--help'],capture_output=True,text=True); self.assertEqual(cli.returncode,0); self.assertIn('--mode',cli.stdout)

if __name__=='__main__':unittest.main(verbosity=2)
