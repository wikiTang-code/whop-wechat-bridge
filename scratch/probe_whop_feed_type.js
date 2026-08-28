import fs from 'fs';

const USER_COOKIE = `whop_sig_id=ba8a2768-40a2-44a5-8e0b-1a0956c9e188; ajs_anonymous_id=0817d850-7f61-48ee-99ae-24e822a2c32e; whop-frosted-theme=appearance:light; _ga=GA1.1.660512276.1772769188; _twpid=tw.1772769188264.726508803115405834; __stripe_mid=75385265-a148-45ad-b1b0-e7ef4ccb011ba9cb76; whop-core.refresh-token=81b0053b0d9fa7c1da73692ab7cc56679b1fd099a0409e0fd8ab51a6a7b54ecb; ajs_user_id=user_moamszyzb64Xw; whop-core.user-id=user_moamszyzb64Xw; _wuid=wuid_48544q1d4r150k5p1c70; _wuid_link=wuid_48544q1d4r150k5p1c70; whop-theme-resolved=light; _gcl_au=1.1.1876679932.1785495674; whop-global-header-last-balance-user_moamszyzb64Xw=0; _scid=Bwq4Sxvi98ceGJhffMNgHgEfdMLf9Sp5; muxData==undefined&mux_viewer_id=3f76138e-4cd4-4f34-932e-958db7d5ebe7&msn=0.999641076820765&sid=752aa5f6-b9d0-4d12-ab9c-6011b7d5ebec&sst=1785495677932&sex=1785497182282; hubspotutk=513447c566b7a0365abc1dfa3b9a0ad7; whop-core.access-token=eyJraWQiOiJkZWZhdWx0LWtleS1pZC1lczI1Ni1wcm9kIiwiYWxnIjoiRVMyNTYifQ.eyJleHAiOjE3ODc5MTU1NDEsInN1YiI6InVzZXJfbW9hbXN6eXpiNjRYdyIsImlhdCI6MTc4NzkxMTk0MSwiaXNzIjoid2hvcC1yYWlscy1wcm9kIiwidHlwIjoiYWNjZXNzIiwidiI6MSwicm9sZXMiOltdLCJlbWFpbCI6Indpa2l0YW5nNjI4QGdtYWlsLmNvbSIsImNyZWF0ZWRfYXQiOjE3NTk3NjUwNjMsInNpZCI6IjRmYWEwOWUzLTIxYWItNDAxZS1hMWIyLTUwNmJhOTQzN2Y2MCJ9.iSqZcXbB1HXApLuN1tRxsPGHSaqMjqzTwF_EPMS5Zclhcd3uFSqHw6bA9mibpAAXeNoYL9R_Nu1j4pFUEmYBdQ; whop-core.uid-token=eyJraWQiOiJkZWZhdWx0LWtleS1pZC1lczI1Ni1wcm9kIiwiYWxnIjoiRVMyNTYifQ.eyJleHAiOjE3ODc5MTU1NDEsInN1YiI6InVzZXJfbW9hbXN6eXpiNjRYdyIsImlhdCI6MTc4NzkxMTk0MSwiaXNzIjoid2hvcC1yYWlscy1wcm9kIiwidHlwIjoidWlkIn0.II3UeVqa1Sw20cygglew8AT-eu3UQFaTykq0i3aKb5l6KeLjjqZnAYn5U-LJAhSwYVkHjrhgwdn5gtfSmKqxFA; whop-core.user-id=user_moamszyzb64Xw; NEXT_LOCALE=zh; whop-theme-resolved=light; __hstc=37712383.513447c566b7a0365abc1dfa3b9a0ad7.1785495695415.1785495695415.1787911946738.2; __hssrc=1; cf_clearance=PYZM9xH1G4wGcSj0ZcJOlt1xTGsb_OdHlTIbhJjT5hU-1787911946-1.2.1.1-XoDbCBEZlXKdv37hU5iwBO.FvxC564l1jIDYeIrkSXA0F6aNHjjcoofSaasgb2e4.8spOYZX5n4q5zGu3WduCW8CMQCNa3lx9cwIuvHboR4CcLp.ZQPiodZ4NXsIW87tfn1gZltk17wd03uX5zg7vaH7dYJSjmWdVoNczJPpAfJgYaBphGaEEqDiJ3e2od.E46zeHj3m1sJTkhb11_swG.8Z1PVDiDkqYmPoSAKRn69glIfJyJ_in1dI.YXV6gMg6Xem8yQBiKzKJCXlP1Qi1A38De3tE4eYkmDmzTYL91OLiBB9zKWMBs3El_u4LRIRJxkIJtagZ_0AFtT6WXc9q1GwgsowQzg6SVzN2F6QamQ; __cf_bm=nbAEo0K7D6eZaSac.7pNJnoQq7OcpiMnJae.OdkLwOs-1787911946.7114787-1.0.1.1-2Y6dR9XzmV252ow1go2ZXDF6b8rXZF97wWtmKd5UOm7mdzGA8pjco17rsjppqXR.psaWgtLoK5lRGUu_2pTpuXq8M0NkzVW96p96ILNiPFxozQkj5xwLsWxNwqEDtK6V; _whop_ssk=5eb2732c-c4d6-4230-b231-699ecd5bbc69; whop_anonymous_id=4790b7da-7df7-486c-aa61-db6ff520bcd6; _sctr=1%7C1787846400000; _tt_enable_cookie=1; _ttp=01M13XPK44N01MZBNBT361N3XQ_.tt.1; _fbp=fb.1.1787911949958.987650576388070265; _cfuvid=i3WPsoZO6mdOGTAXF1tOriOLGqRUN5Z0nuFkeM6rQ7o-1787911950.9813247-1.0.1.1-sErwrZSk1MDk0omqESaFwUkKS.rLxS1EoAs9Bil7R8o; web-personal-view-welcome-dismissed=1; whop-right-sidebar=closed:400; whop-community-nav=%2Fhome%2F; __hssc=37712383.2.1787911946738; ttcsid=1787911949449::K7MWKqm7TcxZ6lf5NeXS.1.1787912077532.0::1.121695.127874::119693.11.1006.279::80697.3.0; ttcsid_D93DANRC77UB3EFMUUR0=1787911949448::6voKb3HohKNUYpwYAVUG.1.1787912077532.1; _scid_r=F4q4Sxvi98ceGJhffMNgHgEfdMLf9Sp5N7t9VA; _ga_NGD3HKQGSV=GS2.1.s1787911946$o4$g1$t1787912077$j56$l0$h0`;

const testTypes = ['chat_feed', 'forum_feed', 'CHAT', 'FORUM'];

async function probe() {
  for (const ft of testTypes) {
    try {
      const res = await fetch('https://whop.com/api/graphql/MessagesFetchFeedPosts/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': USER_COOKIE,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: JSON.stringify({
          query: `
            query MessagesFetchFeedPosts($feedType: FeedTypes!, $feedId: ID!) {
              feedPosts(feedType: $feedType, feedId: $feedId, limit: 10) {
                posts { id createdAt content }
              }
            }
          `,
          variables: {
            feedId: 'chat_feed_1CaEnj8BrNBr95YSbgabYZ',
            feedType: ft
          },
          operationName: 'MessagesFetchFeedPosts'
        })
      });

      const json = await res.json();
      console.log(`FeedType [${ft}] -> HTTP ${res.status}:`, json.data?.feedPosts?.posts?.length ?? json.errors);
    } catch (e) {
      console.log(`FeedType [${ft}] -> Error:`, e.message);
    }
  }
}

probe();
