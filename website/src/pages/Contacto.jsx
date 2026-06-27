import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

// Structural per-track config: which conditional fields render, the icon, and
// the verbatim contact data (emails / numbers stay the same across locales).
const TRACK_META = {
  ventas: {
    icon: 'shopping-bag',
    email: 'hola@puntovivo.co',
    wa: '+57 300 555 0142',
    fields: ['sedes', 'vertical', 'fuente'],
  },
  soporte: {
    icon: 'life-buoy',
    email: 'ayuda@puntovivo.co',
    wa: '+57 300 555 0911',
    fields: ['tenant', 'sede', 'consola'],
  },
  prensa: {
    icon: 'newspaper',
    email: 'prensa@puntovivo.co',
    wa: '+57 300 555 0188',
    fields: ['medio', 'deadline'],
  },
  alianzas: {
    icon: 'handshake',
    email: 'partners@puntovivo.co',
    wa: '+57 300 555 0177',
    fields: ['empresa', 'tipo'],
  },
};
const TRACK_KEYS = ['ventas', 'soporte', 'prensa', 'alianzas'];

function Channels() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section" style={{ paddingTop: 48 }}>
      <div className="head">
        <span className="pv-kicker">{t('contacto.channelsKicker')}</span>
        <h2 className="pv-display">{t('contacto.channelsTitle')}</h2>
        <p className="desc">{t('contacto.channelsDesc')}</p>
      </div>
      <div className="ct-channels">
        <a className="ct-channel ct-channel-wa" href="#">
          <span className="glyph">
            <Icon name="message-circle" size={20} />
          </span>
          <div className="body">
            <span className="t">{t('contacto.channelWaTitle')}</span>
            <span className="d">{t('contacto.channelWaDesc')}</span>
            <span className="v">+57 300 555 0142</span>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </a>
        <a className="ct-channel" href="mailto:hola@puntovivo.co">
          <span className="glyph">
            <Icon name="mail" size={20} />
          </span>
          <div className="body">
            <span className="t">{t('contacto.channelMailTitle')}</span>
            <span className="d">{t('contacto.channelMailDesc')}</span>
            <span className="v">hola@puntovivo.co</span>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </a>
        <a className="ct-channel" href="#">
          <span className="glyph">
            <Icon name="calendar" size={20} />
          </span>
          <div className="body">
            <span className="t">{t('contacto.channelDemoTitle')}</span>
            <span className="d">{t('contacto.channelDemoDesc')}</span>
            <span className="v">{t('contacto.channelDemoValue')}</span>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </a>
        <a className="ct-channel" href="#">
          <span className="glyph">
            <Icon name="github" size={20} />
          </span>
          <div className="body">
            <span className="t">{t('contacto.channelGithubTitle')}</span>
            <span className="d">{t('contacto.channelGithubDesc')}</span>
            <span className="v">{t('contacto.channelGithubValue')}</span>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </a>
      </div>
    </section>
  );
}

function Form() {
  const { t } = useTranslation();
  const [track, setTrack] = useState('ventas');
  const meta = TRACK_META[track];
  const verticalOptions = t('contacto.verticalOptions', { returnObjects: true });
  const fuenteOptions = t('contacto.fuenteOptions', { returnObjects: true });
  const tipoOptions = t('contacto.tipoOptions', { returnObjects: true });

  return (
    <section className="pv-shell pv-section" id="formulario">
      <div className="ct-form-shell">
        <aside className="ct-form-side">
          <span className="pv-kicker">{t('contacto.formSideKicker')}</span>
          <div className="ct-tracks">
            {TRACK_KEYS.map(k => (
              <button
                key={k}
                className={'ct-track' + (k === track ? ' on' : '')}
                onClick={() => setTrack(k)}
              >
                <span className="ic">
                  <Icon name={TRACK_META[k].icon} size={16} />
                </span>
                <span className="t">{t(`contacto.tracks.${k}.label`)}</span>
                {k === track && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>

          <div className="ct-track-meta">
            <div className="row">
              <Icon name="user" size={13} color="var(--primary-700)" />
              <span>{t(`contacto.tracks.${track}.who`)}</span>
            </div>
            <div className="row">
              <Icon name="clock" size={13} color="var(--primary-700)" />
              <span>{t(`contacto.tracks.${track}.sla`)}</span>
            </div>
            <div className="row">
              <Icon name="mail" size={13} color="var(--primary-700)" />
              <span className="mono">{meta.email}</span>
            </div>
            <div className="row">
              <Icon name="message-circle" size={13} color="var(--primary-700)" />
              <span className="mono">{meta.wa}</span>
            </div>
          </div>
        </aside>

        <div className="ct-form">
          <div className="ct-form-head">
            <span className="ic">
              <Icon name={meta.icon} size={20} />
            </span>
            <div>
              <h3 className="pv-display">{t(`contacto.tracks.${track}.label`)}</h3>
              <p>{t(`contacto.tracks.${track}.lead`)}</p>
            </div>
          </div>

          <div className="ct-form-grid">
            <label className="ct-field">
              <span>{t('contacto.fieldName')}</span>
              <input type="text" placeholder={t('contacto.fieldNamePh')} />
            </label>
            <label className="ct-field">
              <span>{t('contacto.fieldCompany')}</span>
              <input type="text" placeholder={t('contacto.fieldCompanyPh')} />
            </label>
            <label className="ct-field">
              <span>{t('contacto.fieldEmail')}</span>
              <input type="email" placeholder={t('contacto.fieldEmailPh')} />
            </label>
            <label className="ct-field">
              <span>
                {t('contacto.fieldWa')} <em>{t('contacto.fieldWaOptional')}</em>
              </span>
              <input type="tel" placeholder={t('contacto.fieldWaPh')} />
            </label>

            {meta.fields.includes('sedes') && (
              <label className="ct-field">
                <span>{t('contacto.fieldSedes')}</span>
                <div className="ct-radio-row">
                  {['1', '2-4', '5-10', '10+'].map(o => (
                    <span key={o} className={'ct-radio' + (o === '2-4' ? ' on' : '')}>
                      {o}
                    </span>
                  ))}
                </div>
              </label>
            )}
            {meta.fields.includes('vertical') && (
              <label className="ct-field">
                <span>{t('contacto.fieldVertical')}</span>
                <select defaultValue="">
                  <option value="" disabled>
                    {t('contacto.selectPlaceholder')}
                  </option>
                  {verticalOptions.map(o => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            )}
            {meta.fields.includes('fuente') && (
              <label className="ct-field">
                <span>{t('contacto.fieldFuente')}</span>
                <select defaultValue="">
                  <option value="" disabled>
                    {t('contacto.selectPlaceholder')}
                  </option>
                  {fuenteOptions.map(o => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            )}
            {meta.fields.includes('tenant') && (
              <label className="ct-field">
                <span>{t('contacto.fieldTenant')}</span>
                <input type="text" placeholder={t('contacto.fieldTenantPh')} className="mono" />
              </label>
            )}
            {meta.fields.includes('sede') && (
              <label className="ct-field">
                <span>{t('contacto.fieldSede')}</span>
                <input type="text" placeholder={t('contacto.fieldSedePh')} />
              </label>
            )}
            {meta.fields.includes('consola') && (
              <label className="ct-field">
                <span>{t('contacto.fieldConsola')}</span>
                <input type="text" placeholder={t('contacto.fieldConsolaPh')} className="mono" />
              </label>
            )}
            {meta.fields.includes('medio') && (
              <label className="ct-field">
                <span>{t('contacto.fieldMedio')}</span>
                <input type="text" placeholder={t('contacto.fieldMedioPh')} />
              </label>
            )}
            {meta.fields.includes('deadline') && (
              <label className="ct-field">
                <span>{t('contacto.fieldDeadline')}</span>
                <input type="date" />
              </label>
            )}
            {meta.fields.includes('empresa') && (
              <label className="ct-field">
                <span>{t('contacto.fieldEmpresaPress')}</span>
                <input type="text" placeholder={t('contacto.fieldEmpresaPressPh')} />
              </label>
            )}
            {meta.fields.includes('tipo') && (
              <label className="ct-field">
                <span>{t('contacto.fieldTipo')}</span>
                <select defaultValue="">
                  <option value="" disabled>
                    {t('contacto.selectPlaceholder')}
                  </option>
                  {tipoOptions.map(o => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="ct-field ct-field-wide">
              <span>{t('contacto.fieldMessage')}</span>
              <textarea rows="4" placeholder={t('contacto.fieldMessagePh')} />
            </label>
          </div>

          <div className="ct-form-foot">
            <span className="note">
              <Icon name="lock" size={12} /> {t('contacto.formNote')}
            </span>
            <a className="pv-btn pv-btn-primary" href="#">
              <Icon name="send" size={14} /> {t('contacto.formSend')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Office() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="ct-office">
        <div className="ct-office-l">
          <span className="pv-kicker">{t('contacto.officeKicker')}</span>
          <h2 className="pv-display">{t('contacto.officeTitle')}</h2>
          <p>{t('contacto.officeDesc')}</p>
          <div className="ct-office-cards">
            <div className="ct-office-card">
              <span className="city">{t('contacto.officeMedellinCity')}</span>
              <span className="addr">
                {t('contacto.officeMedellinAddr1')}
                <br />
                {t('contacto.officeMedellinAddr2')}
              </span>
              <span className="tz">{t('contacto.officeTz')}</span>
            </div>
            <div className="ct-office-card">
              <span className="city">{t('contacto.officeBogotaCity')}</span>
              <span className="addr">
                {t('contacto.officeBogotaAddr1')}
                <br />
                {t('contacto.officeBogotaAddr2')}
              </span>
              <span className="tz">{t('contacto.officeTz')}</span>
            </div>
          </div>
        </div>
        <div className="ct-office-r">
          {/* Stylized map placeholder — striped tiles, not a real map */}
          <div className="ct-map">
            <div className="ct-map-grid" aria-hidden />
            <div className="ct-pin" style={{ top: '32%', left: '44%' }}>
              <span className="halo" />
              <span className="dot" />
              <span className="lbl">{t('contacto.officeMedellinCity')}</span>
            </div>
            <div className="ct-pin" style={{ top: '58%', left: '62%' }}>
              <span className="halo" />
              <span className="dot" />
              <span className="lbl">{t('contacto.officeBogotaCity')}</span>
            </div>
            <div className="ct-map-foot">
              <Icon name="image" size={11} /> {t('contacto.mapFoot')}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Contacto() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        kicker={t('contacto.kicker')}
        title={
          <>
            {t('contacto.titleA')}
            <em>{t('contacto.titleEm')}</em>
            {t('contacto.titleB')}
          </>
        }
        lead={t('contacto.lead')}
        crumbs={[
          { label: t('contacto.crumbInicio'), to: '/' },
          { label: t('contacto.crumbEmpresa') },
          { label: t('contacto.crumbContacto') },
        ]}
        badges={[
          { label: t('contacto.badgeResponse'), tone: 'pv-badge-primary' },
          { label: t('contacto.badgeWa'), tone: 'pv-badge-amber' },
          { label: t('contacto.badgeHours'), tone: 'pv-badge-neutral' },
        ]}
        aside={
          <div className="ct-aside">
            <div className="ct-aside-now">
              <span className="dot" />
              <div>
                <span className="t">{t('contacto.asideOnline')}</span>
                <span className="s">{t('contacto.asideLastReply')}</span>
              </div>
            </div>
            <div className="ct-aside-stats">
              <div className="pv-stat-tile">
                <span className="l">{t('contacto.asideAvgLabel')}</span>
                <span className="v">
                  38<em> min</em>
                </span>
              </div>
              <div className="pv-stat-tile">
                <span className="l">{t('contacto.asideCsatLabel')}</span>
                <span className="v">
                  4.9<em>/5</em>
                </span>
              </div>
            </div>
            <div className="ct-aside-foot">
              <Icon name="info" size={12} /> {t('contacto.asideFoot')}
            </div>
          </div>
        }
      />

      <Channels />
      <Form />
      <Office />
    </>
  );
}
