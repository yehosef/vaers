
This is a copy of the Vaccination Adverse Event Reporting System (VAERS) database available from https://vaers.hhs.gov/.
I've included all the data files in this repo (w/ git LFS) to facilitate downloading and exploring the data.  I will try to keep it up-to-date, but you can always use the above link to get newer data.

I've included the VAERS Data User Guide which includes an explanation of the dataset, the format of the files and fields and the abbreviations used. It also includes the appropriate disclaimers about the data and it's accuracy. The system is voluntary and forms can be submitted by lay-persons.  This causes a few problems:
 * The data can be inaccurate - there are records that mistakenly have an ONSET_DATE before the VAX_DATE, or that there exists a VAX_DATE and an ONSET_DATE but no NUMDAYS data.
 * lack important details - there are 80k records without a VAX_DATE, the descriptions are often vague
 * under-reporting - it's estimated that only 1-10% of the cases are reported to VAERS.

I am importing the data into Elasticsearch (6.x) and visualizing with Grafana (6.x).  I also explore the data with Kibana, but I find the dashboards of Grafana more flexible to work with.  But there are visualization and queries (like Significant Terms) that I cannot do in Grafana (vote for https://github.com/grafana/grafana/issues/3163) so I will use Kibana for those.  


I currently apply a few corrections/modifications to the data:
* In a case where there is no NUMDAYS field but there is a VAX_DATE and ONSET_DATE, I calculate the NUMDAYS
* There were also cases where the ONSET_DATE was before the VAX_DATE - I assumed this was a simple mistake and swap the dates
* I create a VAX_COMBOS field of vaccination combinations (eg, DTAPIPV::FLU4 or FLU3::MMRV)
* I create a "REACTIONS" field which contains boolean fields about the outcome (DIED, ER_VISIT, etc.)
* I create a shorted version of the text fields to help in making dashboards without scripted fields


GOALS:
To facilitate a data-based discussion about the benefits and risks of vaccinations.  In my professional life, I help organizations process and analyze datasets to make Data-Driven/Led decisions.  I wanted to use some of the same tools I use to approach this discussion.  


TODO:
* more data validation 
  - confirm VAX_DATE, ONSET_DATE and NUMDAYS agree
  - NLP to extract patient age, dates, and other relevant information from text fields
  - NLP to identify reports that might be less reliable
* import the data into Postgres and/or SQLite for visualization with Superset and other tools 
* visualize/analyze the data using R/Python
* (possibly) convert scripts to NodeJS/Python
* import more datasets
  - Demographics and vaccination coverage to approximate adverse reaction rates 
  - Non-US datasets (WHO, others)
  - Vaccine costs and health care costs of the diseases
* Make a docker container and/or ansible script to facilitate getting the data up and running for others.
* more...


SCREENSHOTS:

![VAERS ES-Grafana](media/VAERS-ES-Grafana.gif)


For more suggestions or more information, you can contact me, yehosef, at gmail.

Yehosef Shapiro
