(() => {
  'use strict';

  const TABLE = 'music_survey_responses';
  const $ = (id) => document.getElementById(id);
  const form = $('survey-form');
  const submitButton = $('submit-button');
  const refreshButton = $('refresh-button');
  const recommendation = $('recommendation');
  const recommendationCopy = $('recommendation-copy');
  const recommendationLink = $('recommendation-link');
  let db = null;
  let rateChart = null;
  let averageChart = null;
  let refreshing = false;

  function setStatus(id, message, kind = '') {
    const element = $(id);
    element.textContent = message;
    element.className = `status ${kind}`.trim();
  }

  function checkConnection() {
    const cfg = window.SURVEY_CONFIG || {};
    const url = String(cfg.supabaseUrl || '').trim();
    const key = String(cfg.supabasePublishableKey || '').trim();
    if (!url.startsWith('https://') || !key || url.includes('PASTE_') || key.includes('PASTE_')) {
      setStatus('results-status', 'Supabase 연결 설정이 비어 있습니다. config.js에 Project URL과 Publishable key를 입력하세요.', 'error');
      return false;
    }
    if (!window.supabase?.createClient) {
      setStatus('results-status', 'Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 페이지를 새로고침하세요.', 'error');
      return false;
    }
    if (!window.Chart) {
      setStatus('results-status', '그래프 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.', 'error');
      return false;
    }
    try {
      db = window.supabase.createClient(url, key);
      return true;
    } catch (error) {
      setStatus('results-status', `Supabase 연결 실패: ${error.message}`, 'error');
      return false;
    }
  }

  function recommendationFor(genre, agreement) {
    if (agreement <= 2) {
      return {
        name: 'Third Stream',
        description: '클래식과 재즈를 결합한 Third Stream 장르를 탐색해 보세요.',
        url: 'https://rateyourmusic.com/genre/third-stream/'
      };
    }
    if (genre === 'classical') {
      return {
        name: 'Classical Music',
        description: '다양한 시대와 작곡가의 클래식 음악을 찾아보세요.',
        url: 'https://rateyourmusic.com/genre/classical-music/'
      };
    }
    return {
      name: 'Jazz',
      description: '여러 스타일의 재즈 음반과 아티스트를 발견해 보세요.',
      url: 'https://rateyourmusic.com/genre/jazz/'
    };
  }

  function showRecommendation(genre, agreement) {
    const item = recommendationFor(genre, agreement);
    recommendationCopy.textContent = `${item.name} — ${item.description}`;
    recommendationLink.href = item.url;
    recommendationLink.setAttribute('aria-label', `${item.name} 음악 추천 페이지 열기 (새 탭)`);
    recommendation.classList.remove('hidden');
  }

  function makeChart(id, maxValue, suffix, decimals, color) {
    return new window.Chart($(id), {
      type: 'bar',
      data: {
        labels: ['클래식', '재즈'],
        datasets: [{data: [null, null], backgroundColor: [color, '#8b7aae'], borderRadius: 8, barPercentage: .55, categoryPercentage: .7}]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ctx.raw == null ? '응답 없음' : `${Number(ctx.raw).toFixed(decimals)}${suffix}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#596071', font: { size: 13 } } },
          y: { beginAtZero: true, min: 0, max: maxValue, ticks: { stepSize: maxValue === 5 ? 1 : 20, callback: (v) => `${v}${suffix}` }, grid: { color: '#edf0f5' } }
        }
      }
    });
  }

  function renderResults(rows) {
    const groups = {
      classical: {count: 0, sum: 0, matches: 0},
      jazz: {count: 0, sum: 0, matches: 0}
    };
    for (const row of rows) {
      if (!Object.hasOwn(groups, row.genre)) continue;
      const score = Number(row.agreement);
      if (!Number.isInteger(score) || score < 1 || score > 5) continue;
      const item = groups[row.genre];
      item.count++;
      item.sum += score;
      if (score >= 4) item.matches++;
    }
    const classic = groups.classical;
    const jazz = groups.jazz;
    $('total-count').textContent = (classic.count + jazz.count).toLocaleString('ko-KR');
    $('classical-count').textContent = classic.count.toLocaleString('ko-KR');
    $('jazz-count').textContent = jazz.count.toLocaleString('ko-KR');

    const rate = [classic, jazz].map((group) => group.count ? Math.round((group.matches / group.count) * 1000) / 10 : null);
    const average = [classic, jazz].map((group) => group.count ? Math.round((group.sum / group.count) * 100) / 100 : null);
    rateChart.data.datasets[0].data = rate;
    rateChart.update();
    averageChart.data.datasets[0].data = average;
    averageChart.update();
    const fmt = (v, unit) => v === null ? '응답 없음' : `${v.toFixed(unit === '%' ? 1 : 2)}${unit}`;
    $('rate-caption').textContent = `클래식 ${fmt(rate[0], '%')} · 재즈 ${fmt(rate[1], '%')}`;
    $('average-caption').textContent = `클래식 ${fmt(average[0], '점')} · 재즈 ${fmt(average[1], '점')}`;
  }

  // PostgREST 기본 결과 제한(보통 1,000행)에 걸리지 않게 페이지별로 조회합니다.
  async function readAllResponses() {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db.from(TABLE)
        .select('id, genre, agreement')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    return rows;
  }

  async function loadResults() {
    if (!db || refreshing) return;
    refreshing = true;
    try {
      const rows = await readAllResponses();
      renderResults(rows);
      setStatus('results-status', `최신 응답 ${rows.length.toLocaleString('ko-KR')}건 반영 완료`, 'success');
    } catch (error) {
      setStatus('results-status', `결과 불러오기 실패: ${error.message}. schema.sql 실행 여부와 RLS 정책을 확인하세요.`, 'error');
    } finally {
      refreshing = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const genre = form.querySelector('input[name="genre"]:checked')?.value;
    const rawAgreement = form.querySelector('input[name="agreement"]:checked')?.value;
    const agreement = Number(rawAgreement);
    if (!genre || !rawAgreement) {
      setStatus('submit-status', '두 문항에 모두 응답한 후 제출해 주세요.', 'error');
      return;
    }
    if (!db) {
      setStatus('submit-status', '제출할 수 없습니다. GitHub의 config.js에 Supabase Project URL과 Publishable key를 입력한 후 다시 접속하세요.', 'error');
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = '응답 저장 중…';
    setStatus('submit-status', '응답을 저장하고 있습니다.');
    try {
      const { error } = await db.from(TABLE).insert({ genre, agreement });
      if (error) throw error;
      setStatus('submit-status', '설문이 정상적으로 제출되었습니다. 아래의 맞춤 음악과 전체 결과를 확인하세요.', 'success');
      showRecommendation(genre, agreement);
      await loadResults();
      recommendation.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      setStatus('submit-status', `응답 제출 실패: ${error.message}. Supabase에서 schema.sql을 실행했는지와 config.js 설정을 확인하세요.`, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '설문 제출하고 결과 확인하기 →';
    }
  });

  refreshButton.addEventListener('click', () => {
    if (!db) {
      setStatus('results-status', '결과를 조회할 수 없습니다. 먼저 config.js에 Supabase 설정을 입력하세요.', 'error');
      return;
    }
    loadResults();
  });

  // 초기 로딩 / 실시간 INSERT 알림 / 8초마다 백업 조회
  if (checkConnection()) {
    rateChart = makeChart('rate-chart', 100, '%', 1, '#5864ae');
    averageChart = makeChart('average-chart', 5, '점', 2, '#5864ae');
    loadResults();
    db.channel('music-survey-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE }, () => loadResults())
      .subscribe();
    setInterval(() => { if (!document.hidden) loadResults(); }, 8000);
  } else {
    $('rate-caption').textContent = 'Supabase 연결 설정 후 결과가 표시됩니다.';
    $('average-caption').textContent = 'Supabase 연결 설정 후 결과가 표시됩니다.';
  }
})();
