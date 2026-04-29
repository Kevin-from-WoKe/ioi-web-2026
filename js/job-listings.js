/*
// Captcha Script
//<form method="post" action="form-webmailContact.asp" name="form1" onsubmit="return checkform(this);">
function checkform(theform){
var why = "";

if(theform.CaptchaInput.value == ""){
why += "- Please Enter CAPTCHA Code.\n";
}
if(theform.CaptchaInput.value != ""){
if(ValidCaptcha(theform.CaptchaInput.value) == false){
why += "- The CAPTCHA Code Does Not Match.\n";
}
}
if(why != ""){
alert(why);
return false;
}
}

var a = Math.ceil(Math.random() * 9)+ '';
var b = Math.ceil(Math.random() * 9)+ '';
var c = Math.ceil(Math.random() * 9)+ '';
var d = Math.ceil(Math.random() * 9)+ '';
var e = Math.ceil(Math.random() * 9)+ '';

var code = a + b + c + d + e;
document.getElementById("txtCaptcha").value = code;
document.getElementById("CaptchaDiv").innerHTML = code;

// Validate input against the generated number
function ValidCaptcha(){
var str1 = removeSpaces(document.getElementById('txtCaptcha').value);
var str2 = removeSpaces(document.getElementById('CaptchaInput').value);
if (str1 == str2){
return true;
}else{
return false;
}
}

// Remove the spaces from the entered and generated code
function removeSpaces(string){
return string.split(' ').join('');
}
*/


// Validate input against the generated number
function ValidCaptcha(){
	var str1 = removeSpaces(document.getElementById('txtCaptcha').value);
	var str2 = removeSpaces(document.getElementById('CaptchaInput').value);
	if (str1 == str2){
		return true;
	}else{
		return false;
	}
}

// Remove the spaces from the entered and generated code
function removeSpaces(string){
	return string.split(' ').join('');
}


//$("form").submit(function(event){
	/*
	var strMsg = "";

	if($('#CaptchaInput').length > 0){
		if($('#CaptchaInput').val() == ''){
			strMsg += "- Please Enter CAPTCHA Code.\n";	
		}
		else{
			if(!ValidCaptcha($('#CaptchaInput').val())){
				strMsg += "- The CAPTCHA Code Does Not Match.\n";
			}
		}
	}

	if(strMsg != ""){
		alert(strMsg);
		return false;
	}
	*/
	
//	return submitToAPI(event);
	
//});

let lenis;
$(function(){
	//var a = Math.ceil(Math.random() * 9)+ '';
	//var b = Math.ceil(Math.random() * 9)+ '';
	//var c = Math.ceil(Math.random() * 9)+ '';
	//var d = Math.ceil(Math.random() * 9)+ '';
	//var e = Math.ceil(Math.random() * 9)+ '';

	//var code = a + b + c + d + e;
	//document.getElementById("txtCaptcha").value = code;
	//document.getElementById("CaptchaDiv").innerHTML = code;
	
	
	if (Webflow.env("editor") === undefined) {
	  lenis = new Lenis({
		lerp: 0.1,
		wheelMultiplier: 1.5,
		gestureOrientation: "vertical",
		normalizeWheel: false,
		smoothTouch: false
	  });
	  function raf(time) {
		lenis.raf(time);
		requestAnimationFrame(raf);
	  }
	  requestAnimationFrame(raf);
	  const ro = new ResizeObserver(() => lenis.resize());
	  ro.observe(document.body);
	}
	$("[data-lenis-start]").on("click", function () {
	  lenis.start();
	});
	$("[data-lenis-stop]").on("click", function () {
	  lenis.stop();
	});
	$("[data-lenis-toggle]").on("click", function () {
	  $(this).toggleClass("stop-scroll");
	  if ($(this).hasClass("stop-scroll")) {
		lenis.stop();
	  } else {
		lenis.start();
	  }
	});
	
	var SITE_KEY = '6LeD3HMsAAAAAHCDu9iGC-YSptGeh_HuPjIx_CZS';
	var forms = document.querySelectorAll('form[action*="webmailContact"]');
	forms.forEach(function(form) {
		form.addEventListener('submit', function(e) {
			var tokenField = form.querySelector('#g-recaptcha-response');
			//if (!tokenField || tokenField.value) return; // token already set, allow submit
			e.preventDefault();
			//e.stopPropagation(); 
			
			try{
				grecaptcha.ready(function() {
					grecaptcha.execute(SITE_KEY, { action: 'contact' }).then(function(token) {
						tokenField.value = token ;
						
						
						return submitToAPI(e);
						//form.submit(); // native POST — ASP receives it normally
					});
				});
			
			}
			catch(exp)
			{
				console.log('Error: ' + exp.Message);
				return false;
			}						
		});
	});

                        
	var sel = document.getElementById('Job-position');
	var inp = document.getElementById('Job-company');
	function buildMap() {
		var map = {};
		document.querySelectorAll('[data-cms-list="jobListing"] .w-dyn-item').forEach(function (item) {
			var nameEl = item.querySelector('[fs-cmsselect-element="text-value"]');
			if (!nameEl) return;
			var officeEls = item.querySelectorAll('[data-cms-list-ref="jobOff"] [data-cms-filter="name"]');
			var offices = Array.prototype.slice.call(officeEls).map(function (el) { return el.textContent.trim(); }).filter(Boolean).join(', ');
			map[nameEl.textContent.trim()] = offices;
		});
		return map;
	}
	
	function update() {
		var opt = sel.options[sel.selectedIndex];
		inp.value = opt ? (buildMap()[opt.textContent.trim()] || '') : '';
	}
	
	sel.addEventListener('change', update);
	// Re-run after cmsselect populates options
	new MutationObserver(function (_, obs) {
		if (sel.querySelectorAll('option:not([value=""])').length) {
			obs.disconnect();
			sel.addEventListener('change', update);
		}
	}).observe(sel, { childList: true });
                     
          
		  
	$(document).on("click", ".job_toggle", function () {
		var $toggle = $(this);
		var $details = $toggle.next(".job_details");
		var $icon = $toggle.find(".career4_icon-wrapper");
		var isOpen = $toggle.hasClass("is-open");

		if (isOpen) {
			$details.css({ height: "0px", overflow: "hidden" });
			$toggle.removeClass("is-open");
			$icon.text("↓");
			$toggle.find(".text-block").contents().filter(function () { return this.nodeType === 3; }).first().replaceWith("Show job details ");
		} else {
			$details.css({ height: "auto", overflow: "visible" });
			$toggle.addClass("is-open");
			$icon.text("↑");
			$toggle.find(".text-block").contents().filter(function () { return this.nodeType === 3; }).first().replaceWith("Hide job details ");
		}
	});

	document.addEventListener("click", function (e) {

		const button = e.target.closest(".jobApplyAction");
		if (!button) return;

		const jobItem = button.closest(".career4_item");
		if (!jobItem) return;
		
		// Get position
		const position = jobItem.querySelector('[fs-cmsfilter-field="name"]').innerText.trim();

		const positionDropdown = document.getElementById("Job-position");
		const companyDropdown = document.getElementById("Job-company");

		if (positionDropdown) {
			positionDropdown.value = position;
		}
		
		// Get company (first one if multiple)

		const companies = [...jobItem.querySelectorAll('[fs-cmsfilter-field="company"]')]
			.filter(el => el.offsetParent !== null)
			.map(el => el.innerText.trim())
			.filter(text => text.length > 0);

		const company = companies.join(", ");

		if (companyDropdown) {
			companyDropdown.value = company;
		}
		//update();

		/*
		document.querySelectorAll(".jobApplyAction").forEach(button => {
			button.addEventListener("click", function () {

			const jobItem = this.closest(".career4_item");

			// Get position
			const position = jobItem.querySelector('[fs-cmsfilter-field="name"]').innerText.trim();

			// Get company (first one if multiple)
			const companyEl = jobItem.querySelector('[fs-cmsfilter-field="company"]');
			const company = companyEl ? companyEl.innerText.trim() : "";

			// Select dropdowns
			const positionDropdown = document.getElementById("position-dropdown");
			//const companyDropdown = document.getElementById("company-dropdown");

			if (positionDropdown) {
				positionDropdown.value = position;
			}

			update();

			
			//if (companyDropdown) {
			//companyDropdown.value = company;
			//}
			

			});
		});
		*/

	});
	
	  let siteYearLabel = document.getElementById('siteYear');
	  if(siteYearLabel)
	  {
		siteYearLabel.innerText = new Date().getFullYear();
	  }
	  
	  let langOpt = document.getElementById('lnkLangOpt');
  
	  if(langOpt)
	  {
			langOpt.style.display = 'none';
	  }
	  
	  
		  
});




function submitToAPI(e) {
	var blnSuccessAPI = false;
	
	var URL = "https://uudwr4nux0.execute-api.ap-southeast-1.amazonaws.com/APIStage/contactus";

		/*var Namere = /[A-Za-z]{1}[A-Za-z]/;
		if (!Namere.test($("#txtContactName").val())) {
					 alert ("Name can not less than 2 char");
			return;
		}
		var mobilere = /[0-9]{10}/;
		if (!mobilere.test($("#txtPhone").val())) {
			alert ("Please enter valid mobile number");
			return;
		}
		if ($("#txtEmail").val()=="") {
			alert ("Please enter your email id");
			return;
		}

		var reeamil = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,6})?$/;
		if (!reeamil.test($("#txtEmail").val())) {
			alert ("Please enter valid email address");
			return;
		}*/

	let data = {};

	var externalFirstName = $("#Applicant-First-Name").val();
	var externalLastName = $("#Applicant-Last-Name").val();
	var externalEmail = $("#Applicant-Email").val();
	var externalPhone = $("#Applicant-Phone").val();
	var externalPosition = $("#Job-position").val();
	var externalCompany = $("#Job-company").val();
	var externalMessage = $("#Applicant-Message").val();
	
	//let enquiry = "";
	//let productText ="";
	//let products = [];
	
	data.firstName = externalFirstName;
	data.lastName = externalLastName;
	data.email = externalEmail;
	data.phone = externalPhone;
	data.position = externalPosition;
	data.company = externalCompany;
	data.message = externalMessage;
	
	let recaptchaToken = "";
	if($('#g-recaptcha-response').length > 0)
	{
		recaptchaToken = $('#g-recaptcha-response').val();
	}
		
	data.recaptchaToken = recaptchaToken
	data.Iswebflow = 1;

	
	var reeamil = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,6})?$/;
	var intToRecipient = 0;
	var intCcRecipient = 0;
	var intBccRecipient = 1;
	var emailSubject = "Job Application Form";
	
	if(externalEmail !== ''){
		var externalEmails = externalEmail.split(/[;,]+/); 
		var extermalValidEmail = true;
		
		for (var iEmail in externalEmails) {
            var trimmedEmail = externalEmails[iEmail].trim();
            if (trimmedEmail !== "" ) { // Only validate non-empty strings
                if (!reeamil.test(trimmedEmail)) {
					extermalValidEmail = false;
				}
            }
        }
		
		if (!extermalValidEmail) {
			alert ("Please enter valid email address");
			return false;
		}
	}
	
	
	var emailContent = 'First Name : ' + externalFirstName + '<br /><br />' +
		'Last Name : ' + externalLastName + '<br /><br />' +
		'Phone : ' + externalPhone + '<br /><br />' +
		'Email : ' + externalEmail + '<br /><br />' +
		'Position : ' + externalPosition + '<br /><br />' +
		'Company : ' + externalCompany + '<br /><br />' +
		'Message : ' + externalMessage + '<br /><br />' ;
	

	data.htmlContent = emailContent;
		
				
	if(externalCompany === 'IOI Acidchem Sdn. Bhd.' || externalCompany === 'IOI Esterchem (M) Sdn. Bhd.' || externalCompany === 'IOI Acidchem Sdn. Bhd., IOI Esterchem (M) Sdn. Bhd.'){
		intToRecipient = 22
	}
	
	else if(externalCompany === 'IOI Pan-Century Edible Oils Sdn. Bhd.' || externalCompany === 'IOI Pan-Century Oleochemicals Sdn. Bhd.' || externalCompany === 'IOI Pan-Century Edible Oils Sdn. Bhd., IOI Pan-Century Oleochemicals Sdn. Bhd.'){
		intToRecipient = 23;
	}
	else {
		alert('Please select the company.');
		return false;
	}
	
	data.toRecipient = intToRecipient;
	data.emailSubject= emailSubject;
	data.ccRecipient = intCcRecipient;
	data.bccRecipient = intBccRecipient;
			
	
	try{
		$.ajax({
			type: "POST",
			url :URL,
			dataType: "json",
			/*crossDomain: "true",*/
			contentType: "application/json; charset=utf-8",
			async: false,
			cache: false,
			data: JSON.stringify(data),
			success: function (returnedData, textStatus, jqXHR) {
			// clear form and show a success message
				
				var intStatus = 400;
				var objReturnedMsg = null;
				var strReturnedMsg = '';
				var objReturnedData = null;
				
				if(returnedData){
					objReturnedData = returnedData;
				}
				
				
				if(objReturnedData ){
					if(objReturnedData.statusCode){
						intStatus = objReturnedData.statusCode;
						
						if(objReturnedData.body){
							if(objReturnedData.body.trim() !==''){
								objReturnedMsg = JSON.parse(objReturnedData.body);
							
								if(objReturnedMsg){
									if(objReturnedMsg.message){
										strReturnedMsg = objReturnedMsg.message;
									}
									
									if(objReturnedMsg.error){
										strReturnedMsg = objReturnedMsg.error;
									}
									
								}
							}
						}
					}
					else{
						intStatus = 500;
						if(objReturnedData.errorMessage){
							
							if(objReturnedData.errorType){
								if(objReturnedData.errorType === "Sandbox.Timedout"){
									strReturnedMsg = "Verification timed out. Please try again.";
								}
								else{
									strReturnedMsg = objReturnedData.errorMessage;
								}
								
							}
						}
						else{
							strReturnedMsg = 'Failed to proceess.';
						}
						
					}
					
					
				}
				
				console.log('Returned response : status: ' +  intStatus.toString() + ', message: ' + strReturnedMsg );
			
				blnSuccessAPI = true;
				if(intStatus >= 400 && intStatus < 600 ){
					alert(strReturnedMsg)
					return false;
				}
				else {
					
					alert('Your information has been submitted.')
					location.reload();
					return false;
				}
					
			},
			error: AjaxOnError
		});
	}
	catch(exAPI){
		console.error("An error occurred:", exAPI.message);
	}
	
	if(!blnSuccessAPI){
		//Back to old method
		//return true;
		return false; //no longer used asp
		
	}
	else{
		e.preventDefault();
		return false;
	}
 }
	 
function AjaxOnError(xhr, errorType, exception) {
	var responseText = '';
	var strAlert = '';

	if(xhr && xhr.responseText){
		responseText = $.parseJSON(xhr.responseText);
		strAlert = errorType + ' ' + exception + '\n' +
		responseText.Message + '\n' +
		responseText.ExceptionType + '\n' +
		responseText.StackTrace + '\n';
	}
	else{
		strAlert = errorType + ' ' + exception + '\n';
	}

	alert(strAlert);

}


function getCheckedLabels() {
  const checkedInputs = document.querySelectorAll('input[type="checkbox"]:checked');

	
	let arryDataProduct = [];
	

  const results = Array.from(checkedInputs).map(input => {
    const label = input.closest('label');

    const mainText = label.querySelector('.form_checkbox-label')?.textContent.trim() || '';
    const subText = label.querySelector('.margin-xxsmall')?.textContent.trim() || '';
	let dataProduct = {};
	dataProduct.productName = `${mainText} - ${subText}`;
	
	arryDataProduct.push(dataProduct);

    return `${mainText} - ${subText}`;
  });



  return { fullText: results.join(', '), products: arryDataProduct };
}

