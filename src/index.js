require('dotenv/config')
const { Client } = require('@notionhq/client');

const today = new Date();
today.setHours(0)
today.setMinutes(0)
today.setSeconds(0)
const tomorrow = incrementDate(today, 1);

function incrementDate(dateInput, increment) {
  return new Date(dateInput.getTime() + (increment * 86400000));
}

const notion = new Client({ auth: process.env.NOTION_INTERNAL_INTEGRATION_TOKEN });

const getPage = memo((id) => notion.pages.retrieve({ page_id: id }));

function memo(cb) {
  const memo = {};
  return async function () {
    const key = JSON.stringify(arguments);
    if (!memo[key]) memo[key] = await cb.apply(null, arguments);
    return memo[key];
  }
}

async function* getAllPages(databaseId) {
  let response = {
    has_more: true,
    next_cursor: undefined
  }

  while (response.has_more) {
    response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: response.next_cursor,
      filter: {
        and: [
          {
            property: 'Status',
            select: {
              does_not_equal: 'Completed',
            },
          },
          {
            property: 'Date',
            date: {
              on_or_before:  '2022-03-30' //(new Date())
            }
          }
        ],
      },
      sorts: [
        {
          property: 'Date',
          direction: 'ascending',
        },
      ],
    });

    for (let index = 0; index < response.results.length; index++) {
      const element = response.results[index];
      yield element
    }
  }
}

(async () => {
  const tasks = await getAllPages(process.env.NOTION_TASKS_DATABASE_ID)

  const scopes = {}

  while (task = (await tasks.next()).value) {
    const scope = task.properties.Scope.relation[0]?.id ? await getPage(task.properties.Scope.relation[0].id) : {
      id: 'No Scope',
      properties: {Name: {title: [{plain_text: 'No Scope'}]}}
    }

    scopes[scope.id] ??= {
      name: scope.properties.Name.title[0].plain_text,
      id: scope.id,
      progress: scope.properties['% Burnt']?.formula.string,
      estimated: scope.properties['Estimated Hours']?.rollup.number,
      burnt: scope.properties['Burnt Hours']?.rollup.number,
      url: scope.properties.Scope?.url,
      endDate: scope.properties['Date']?.rollup.date.end ? (new Date(scope.properties['Date']?.rollup.date.end)).toISOString().split('T')[0] : null,
      tasks: []
    };

    const taskEndDate = new Date(task.properties.Date.date.end ?? task.properties.Date.date.start)

    let name = task.properties.Name.title[0].plain_text;
    if (taskEndDate < today) {
      name = '**OVERDUE** - ' + name;
    }

    scopes[scope.id].tasks.push(name)
  }

  process.stdout.write(`${Object.values(scopes).map(s => `#### ${s.url ? `[${s.name}]` : s.name}\n${s.tasks.map(t => `   - ${t}`).join('\n')}`).join('\n')}\n`)

  process.stdout.write('--------\n')

  process.stdout.write(Object.values(scopes).filter(s => s.id != 'No Scope').map(s => `| 3-3 | ${s.name} | ${s.progress} | ${s.endDate} | ${s.burnt}/${s.estimated} |    |`).join('\n') + '\n')

  process.stdout.write('--------\n')

  process.stdout.write(`${Object.values(scopes).filter(s => s.url).map(s => `[${s.name}]: ${s.url}`).join('\n')}\n`)
})();