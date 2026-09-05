/** Raw SQLite qualification for private pre-payroll lineage, scope and terminal states. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

const sqlite = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const now = '2026-09-04T12:00:00.000Z';
const json = (value: unknown) => JSON.stringify(value);

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES
      ('a','A','a-payroll','COP'),('b','B','b-payroll','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES
      ('company-a','a','A'),('company-b','b','B');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES
      ('site-a','a','company-a','A'),('site-b','b','company-b','B');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin-a','a','Admin A','admin-a@payroll.test','unused','admin'),
      ('worker-a','a','Worker A','worker-a@payroll.test','unused','cashier'),
      ('admin-b','b','Admin B','admin-b@payroll.test','unused','admin'),
      ('worker-b','b','Worker B','worker-b@payroll.test','unused','cashier');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('a','CO'),('b','CO');
    INSERT INTO employment_contracts(
      id,tenant_id,user_id,site_id,position,effective_from,time_zone,currency_code,
      pay_basis,pay_amount,version,created_by_user_id,updated_by_user_id
    ) VALUES (
      'contract-a','a','worker-a','site-a','Cashier','2026-01-01','America/Bogota',
      'COP','hourly',1000,1,'admin-a','admin-a'
    );
  `);
});
afterEach(() => closeDatabase());

function insertProfile() {
  sqlite()
    .prepare(
      `INSERT INTO payroll_employee_profiles(
        id,tenant_id,user_id,site_id,country_code,identification_type,
        identification_number,contributor_type,contract_kind,arl_risk_class,
        payment_method,payment_account_last4,effective_from,created_by_user_id,
        updated_by_user_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'profile-a',
      'a',
      'worker-a',
      'site-a',
      'CO',
      'CC',
      '123456789',
      '01',
      'indefinite',
      1,
      'transfer',
      '1234',
      '2026-01-01',
      'admin-a',
      'admin-a'
    );
  sqlite()
    .prepare(
      `INSERT INTO payroll_employee_profile_events(
        id,tenant_id,profile_id,version,kind,actor_id,operation_id,reason,before_json,after_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'profile-event-a',
      'a',
      'profile-a',
      1,
      'created',
      'admin-a',
      'op-profile-a',
      'Initial reviewed payroll profile',
      null,
      json({ userId: 'worker-a', version: 1 }),
      now
    );
}

function insertApprovedRun() {
  insertProfile();
  sqlite().exec(`
    INSERT INTO payroll_periods(
      id,tenant_id,country_code,frequency,from_date,until_date,pay_date,currency_code,
      created_reason,created_by_user_id
    ) VALUES (
      'period-a','a','CO','monthly','2026-08-01','2026-09-01','2026-09-05','COP',
      'Reviewed monthly period fixture','admin-a'
    );
    INSERT INTO payroll_runs(
      id,tenant_id,period_id,kind,status,current_revision,version,created_by_user_id
    ) VALUES ('run-a','a','period-a','regular','draft',0,1,'admin-a');
    INSERT INTO payroll_run_events(
      id,tenant_id,run_id,version,kind,revision,actor_id,operation_id,snapshot_json
    ) VALUES (
      'run-event-created','a','run-a',1,'created',0,'admin-a','op-run-created',
      '{"status":"draft","currentRevision":0,"reviewedRevision":null,"approvedRevision":null,"version":1}'
    );
  `);
  sqlite()
    .prepare(
      `INSERT INTO payroll_run_revisions(
        id,tenant_id,run_id,revision,status,policy_version,policy_snapshot_json,
        source_cutoff,currency_code,gross_amount,deduction_amount,net_amount,
        employer_contribution_amount,blockers_json,generated_by_user_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'revision-a',
      'a',
      'run-a',
      1,
      'complete',
      'co-prepayroll-2026-transitional-v1',
      json({ policyVersion: 'co-prepayroll-2026-transitional-v1', sourceUrls: [] }),
      now,
      'COP',
      1000,
      80,
      920,
      120,
      json([]),
      'admin-a'
    );
  sqlite()
    .prepare(
      `INSERT INTO payroll_employee_results(
        id,tenant_id,revision_id,user_id,payroll_profile_id,employment_contract_id,
        source_snapshot_json,status,currency_code,gross_amount,deduction_amount,
        net_amount,employer_contribution_amount,blockers_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'result-a',
      'a',
      'revision-a',
      'worker-a',
      'profile-a',
      'contract-a',
      json({ sourceCutoff: now, attendanceIds: [] }),
      'complete',
      'COP',
      1000,
      80,
      920,
      120,
      json([])
    );
  const insertSource = sqlite().prepare(
    `INSERT INTO payroll_result_sources(
      id,tenant_id,employee_result_id,kind,source_id,source_version,
      source_digest,source_snapshot_json
    ) VALUES (?,?,?,?,?,?,?,?)`
  );
  insertSource.run(
    'source-profile-a',
    'a',
    'result-a',
    'payroll_profile',
    'profile-a',
    1,
    'a'.repeat(64),
    json({ id: 'profile-a', version: 1 })
  );
  insertSource.run(
    'source-contract-a',
    'a',
    'result-a',
    'employment_contract',
    'contract-a',
    1,
    'b'.repeat(64),
    json({ id: 'contract-a', version: 1 })
  );
  insertSource.run(
    'source-policy-a',
    'a',
    'result-a',
    'policy',
    'co-prepayroll-2026-transitional-v1',
    null,
    'c'.repeat(64),
    json({ policyVersion: 'co-prepayroll-2026-transitional-v1' })
  );
  const insertConcept = sqlite().prepare(
    `INSERT INTO payroll_concept_lines(
      id,tenant_id,employee_result_id,category,code,label,origin,unit,amount,
      source_refs_json,created_by_user_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  insertConcept.run(
    'earning-a',
    'a',
    'result-a',
    'earning',
    'REGULAR',
    'Regular earning',
    'attendance',
    'amount',
    1000,
    json(['contract-a']),
    'admin-a'
  );
  insertConcept.run(
    'deduction-a',
    'a',
    'result-a',
    'deduction',
    'HEALTH',
    'Health deduction',
    'policy',
    'amount',
    80,
    json(['co-prepayroll-2026-transitional-v1']),
    'admin-a'
  );
  insertConcept.run(
    'contribution-a',
    'a',
    'result-a',
    'employer_contribution',
    'EMPLOYER_HEALTH',
    'Employer health',
    'policy',
    'amount',
    120,
    json(['co-prepayroll-2026-transitional-v1']),
    'admin-a'
  );
  sqlite().exec(`
    UPDATE payroll_runs
      SET current_revision=1,version=2,updated_at='${now}'
      WHERE id='run-a';
    INSERT INTO payroll_run_events(
      id,tenant_id,run_id,version,kind,revision,actor_id,operation_id,snapshot_json
    ) VALUES (
      'run-event-calculated','a','run-a',2,'recalculated',1,'admin-a','op-run-calculated',
      '{"status":"draft","currentRevision":1,"reviewedRevision":null,"approvedRevision":null,"version":2}'
    );
    UPDATE payroll_runs SET
      status='reviewed',reviewed_revision=1,reviewed_by_user_id='admin-a',
      reviewed_at='${now}',version=3,updated_at='${now}'
      WHERE id='run-a';
    INSERT INTO payroll_run_events(
      id,tenant_id,run_id,version,kind,revision,actor_id,operation_id,reason,snapshot_json
    ) VALUES (
      'run-event-reviewed','a','run-a',3,'reviewed',1,'admin-a','op-run-reviewed',
      'Reviewed complete frozen calculation',
      '{"status":"reviewed","currentRevision":1,"reviewedRevision":1,"approvedRevision":null,"version":3}'
    );
    UPDATE payroll_runs SET
      status='approved',approved_revision=1,approved_by_user_id='admin-a',
      approved_at='${now}',version=4,updated_at='${now}'
      WHERE id='run-a';
    INSERT INTO payroll_run_events(
      id,tenant_id,run_id,version,kind,revision,actor_id,operation_id,reason,snapshot_json
    ) VALUES (
      'run-event-approved','a','run-a',4,'approved',1,'admin-a','op-run-approved',
      'Approved exact reviewed calculation',
      '{"status":"approved","currentRevision":1,"reviewedRevision":1,"approvedRevision":1,"version":4}'
    );
    INSERT INTO payroll_provider_jobs(
      id,tenant_id,run_id,revision,employee_result_id,adapter_id,payload_json
    ) VALUES (
      'provider-a','a','run-a',1,'result-a','sandbox_v1',
      '{"kind":"sandbox","employeeResultId":"result-a"}'
    );
  `);
}

describe('Colombia pre-payroll storage', () => {
  it('applies the additive schema without inventing profiles, periods or runs', () => {
    for (const table of [
      'payroll_employee_profiles',
      'payroll_periods',
      'payroll_runs',
      'payroll_run_revisions',
      'payroll_employee_results',
      'payroll_concept_lines',
      'payroll_result_sources',
      'payroll_provider_jobs',
    ]) {
      expect(sqlite().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    }
    expect(sqlite().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps profile identity tenant-scoped and its event evidence immutable', () => {
    expect(() =>
      sqlite()
        .prepare(
          `INSERT INTO payroll_employee_profiles(
          id,tenant_id,user_id,site_id,country_code,identification_type,
          identification_number,contributor_type,contract_kind,arl_risk_class,
          payment_method,effective_from,created_by_user_id,updated_by_user_id
        ) VALUES ('bad','a','worker-b','site-a','CO','CC','999999','01','indefinite',1,'cash','2026-01-01','admin-a','admin-a')`
        )
        .run()
    ).toThrow(/PAYROLL_PROFILE_SCOPE_INVALID/);
    insertProfile();
    expect(() =>
      sqlite()
        .prepare("UPDATE payroll_employee_profile_events SET reason='Rewritten evidence row'")
        .run()
    ).toThrow(/PAYROLL_PROFILE_EVENT_IMMUTABLE/);
    expect(() => sqlite().prepare('DELETE FROM payroll_employee_profile_events').run()).toThrow(
      /PAYROLL_PROFILE_EVENT_IMMUTABLE/
    );
    expect(() => sqlite().prepare('DELETE FROM payroll_employee_profiles').run()).toThrow(
      /PAYROLL_PROFILE_DELETE_FORBIDDEN/
    );
  });

  it('enforces append-only revisions and exact monotonic review and approval', () => {
    insertApprovedRun();
    expect(
      sqlite().prepare("SELECT status,version FROM payroll_runs WHERE id='run-a'").get()
    ).toEqual({
      status: 'approved',
      version: 4,
    });
    expect(() =>
      sqlite().prepare("UPDATE payroll_runs SET status='draft',version=5 WHERE id='run-a'").run()
    ).toThrow(/PAYROLL_RUN_TRANSITION_INVALID/);
    for (const [table, error] of [
      ['payroll_run_revisions', 'PAYROLL_REVISION_IMMUTABLE'],
      ['payroll_employee_results', 'PAYROLL_EMPLOYEE_RESULT_IMMUTABLE'],
      ['payroll_result_sources', 'PAYROLL_RESULT_SOURCE_IMMUTABLE'],
      ['payroll_concept_lines', 'PAYROLL_CONCEPT_IMMUTABLE'],
      ['payroll_run_events', 'PAYROLL_RUN_EVENT_IMMUTABLE'],
    ] as const) {
      expect(() => sqlite().prepare(`UPDATE ${table} SET created_at=created_at`).run()).toThrow(
        new RegExp(error)
      );
      expect(() => sqlite().prepare(`DELETE FROM ${table}`).run()).toThrow(new RegExp(error));
    }
    expect(sqlite().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(sqlite().prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('accepts one sandbox terminal result and rejects replay or identity mutation', () => {
    insertApprovedRun();
    sqlite()
      .prepare(
        `UPDATE payroll_provider_jobs SET
        status='accepted',response_json=?,updated_at=? WHERE id='provider-a' AND status='queued'`
      )
      .run(json({ sandboxReceipt: 'accepted-a' }), now);
    expect(
      sqlite()
        .prepare(
          "SELECT status,error_code AS errorCode FROM payroll_provider_jobs WHERE id='provider-a'"
        )
        .get()
    ).toEqual({ status: 'accepted', errorCode: null });
    expect(() =>
      sqlite()
        .prepare(
          `UPDATE payroll_provider_jobs SET status='rejected',response_json=?,error_code='late',updated_at=? WHERE id='provider-a'`
        )
        .run(json({}), now)
    ).toThrow(/PAYROLL_PROVIDER_JOB_TRANSITION_INVALID/);
    expect(() => sqlite().prepare('DELETE FROM payroll_provider_jobs').run()).toThrow(
      /PAYROLL_PROVIDER_JOB_DELETE_FORBIDDEN/
    );
  });

  it('rejects a provider job unless the exact employee revision is complete and approved', () => {
    insertProfile();
    sqlite().exec(`
      INSERT INTO payroll_periods(
        id,tenant_id,country_code,frequency,from_date,until_date,pay_date,currency_code,
        created_reason,created_by_user_id
      ) VALUES (
        'period-a','a','CO','monthly','2026-08-01','2026-09-01','2026-09-05','COP',
        'Reviewed monthly period fixture','admin-a'
      );
      INSERT INTO payroll_runs(id,tenant_id,period_id,kind,created_by_user_id)
        VALUES ('run-a','a','period-a','regular','admin-a');
    `);
    expect(() =>
      sqlite()
        .prepare(
          `INSERT INTO payroll_provider_jobs(
          id,tenant_id,run_id,revision,employee_result_id,adapter_id,payload_json
        ) VALUES ('bad-job','a','run-a',1,'missing','sandbox_v1','{}')`
        )
        .run()
    ).toThrow(/PAYROLL_PROVIDER_JOB_SCOPE_INVALID|FOREIGN KEY/);
  });
});
