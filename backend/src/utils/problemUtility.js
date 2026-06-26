const axios = require('axios');


const getLanguageById = (lang)=>{

    const language = {
        "c++":54,
        "java":62,
        "javascript":63,
        "python":71
    }
    return language[lang.toLowerCase()];
}

const getJudge0Config = () => {
    let baseUrl = process.env.JUDGE0_URL || 'https://ce.judge0.com';
    const apiKey = process.env.JUDGE0_KEY || process.env.JUDGE0_API_KEY;
    const isRapidAPI = baseUrl.includes('rapidapi.com');
    const hasKey = apiKey && apiKey !== 'your_rapidapi_key';

    // If rapidapi URL is set but no key is provided, fallback to ce.judge0.com
    if (isRapidAPI && !hasKey) {
        baseUrl = 'https://ce.judge0.com';
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    if (hasKey && baseUrl.includes('rapidapi.com')) {
        headers['x-rapidapi-key'] = apiKey;
        headers['x-rapidapi-host'] = new URL(baseUrl).hostname;
    } else if (hasKey) {
        headers['x-rapidapi-key'] = apiKey;
    }

    return { baseUrl, headers };
};

const submitBatch = async (submissions)=>{

const { baseUrl, headers } = getJudge0Config();
const options = {
  method: 'POST',
  url: `${baseUrl}/submissions/batch`,
  params: {
    base64_encoded: 'false'
  },
  headers: headers,
  data: {
    submissions
  }
};

async function fetchData() {
	try {
		const response = await axios.request(options);
		return response.data;
	} catch (error) {
		console.error('Judge0 Batch Submit Error:', error.message);
		throw error;
	}
}

 return await fetchData();

}


const waiting = (timer) => new Promise(resolve => setTimeout(resolve, timer));

const submitToken = async(resultToken)=>{

const { baseUrl, headers } = getJudge0Config();
const options = {
  method: 'GET',
  url: `${baseUrl}/submissions/batch`,
  params: {
    tokens: resultToken.join(","),
    base64_encoded: 'false',
    fields: '*'
  },
  headers: headers
};

async function fetchData() {
	try {
		const response = await axios.request(options);
		return response.data;
	} catch (error) {
		console.error('Judge0 Token Status Error:', error.message);
		throw error;
	}
}


 while(true){

 const result =  await fetchData();
 
 if (!result || !result.submissions) {
     throw new Error('Invalid response from Judge0 server');
 }

  const IsResultObtained =  result.submissions.every((r)=>r.status_id>2);

  if(IsResultObtained)
    return result.submissions;

  
  await waiting(1000);
}


}

module.exports = {getLanguageById,submitBatch,submitToken};



